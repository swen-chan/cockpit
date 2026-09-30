import "server-only";

import { opendirSync } from "node:fs";
import path from "node:path";

import {
  claudeSystemSnapshotSchema,
  type ClaudeSystemSnapshot,
  type ClaudeSystemSource,
} from "@/contracts/claude-system";
import { resolveClaudeProject } from "@/server/claude/projects";
import { readNamedTextSource } from "@/server/files/bounded-text";
import type { ClaudePanelDescriptor } from "@/server/panels/registry";
import { hasExcludedSegment } from "@/server/security/credentials";
import { SourceSecurityError } from "@/server/security/errors";
import { boundUtf8Text } from "@/server/security/limits";
import {
  canonicalizeDirectory,
  withExistingWorkspaceDirectory,
} from "@/server/security/path-policy";
import { cleanBrowserText } from "@/server/security/safe-text";
import { assertSourceReadAllowed } from "@/server/security/prerender-guard";

const MAX_SOURCES = 100;
const MAX_SCAN_ENTRIES = 500;
const MAX_DOCUMENT_BYTES = 32 * 1_024;
const MAX_TOTAL_BYTES = 256 * 1_024;
const MAX_DOCUMENT_CHARACTERS = 20_000;
const MAX_RULE_DEPTH = 8;

interface ScanState {
  sources: ClaudeSystemSource[];
  bytesRemaining: number;
  entriesRemaining: number;
  limited: boolean;
  unavailableScopes: Set<ClaudeSystemSnapshot["unavailableScopes"][number]>;
  literalPaths: readonly (string | undefined)[];
}

interface SourceRoot {
  root: string;
  scope: ClaudeSystemSource["scope"];
  prefix: string;
}

function isMissing(error: unknown): boolean {
  return error instanceof SourceSecurityError && error.code === "missing_source";
}

function hasCapacity(state: ScanState): boolean {
  return state.sources.length < MAX_SOURCES && state.bytesRemaining > 0;
}

async function addDocument(
  state: ScanState,
  source: SourceRoot,
  relativePath: string,
  category: ClaudeSystemSource["category"],
): Promise<void> {
  if (!hasCapacity(state)) {
    state.limited = true;
    return;
  }
  const displayPath = `${source.prefix}${relativePath}`;
  const cleanedPath = cleanBrowserText(displayPath);
  if (!cleanedPath.text || cleanedPath.policyChanged || displayPath.length > 1_024) return;
  let content: string | null = null;
  let truncated = false;
  let status: ClaudeSystemSource["state"] = "ready";
  try {
    const document = await readNamedTextSource(source.root, relativePath, {
      maxBytes: Math.min(MAX_DOCUMENT_BYTES, state.bytesRemaining),
      maxCharacters: MAX_DOCUMENT_CHARACTERS,
    });
    const cleaned = cleanBrowserText(document.text, {
      literalPaths: state.literalPaths,
      trim: false,
    });
    if (cleaned.text === null) {
      status = "unavailable";
    } else {
      const bounded = boundUtf8Text(
        cleaned.text,
        Math.min(MAX_DOCUMENT_BYTES, state.bytesRemaining),
        MAX_DOCUMENT_CHARACTERS,
      );
      content = bounded.text;
      truncated = document.truncated || bounded.truncated;
      state.bytesRemaining -= Buffer.byteLength(content, "utf8");
    }
  } catch (error) {
    if (isMissing(error)) return;
    status = "unavailable";
  }
  state.sources.push({
    key: `source-${state.sources.length + 1}`,
    category,
    scope: source.scope,
    relativePath: displayPath,
    state: status,
    content,
    truncated,
  });
}

async function entries(state: ScanState, source: SourceRoot, relativePath: string) {
  try {
    return await withExistingWorkspaceDirectory(source.root, relativePath, ({ absolutePath }) => {
      const directory = opendirSync(absolutePath);
      const found: { name: string; directory: boolean; file: boolean }[] = [];
      try {
        for (;;) {
          const entry = directory.readSync();
          if (!entry) break;
          if (state.entriesRemaining === 0) {
            state.limited = true;
            break;
          }
          state.entriesRemaining -= 1;
          if (hasExcludedSegment([entry.name])) continue;
          found.push({ name: entry.name, directory: entry.isDirectory(), file: entry.isFile() });
        }
      } finally {
        directory.closeSync();
      }
      return found.sort((left, right) => left.name.localeCompare(right.name));
    });
  } catch (error) {
    if (!isMissing(error)) state.unavailableScopes.add(source.scope);
    return [];
  }
}

async function markdownDirectory(
  state: ScanState,
  source: SourceRoot,
  relativePath: string,
  category: ClaudeSystemSource["category"],
  depth = 0,
): Promise<void> {
  for (const entry of await entries(state, source, relativePath)) {
    if (!hasCapacity(state)) {
      state.limited = true;
      break;
    }
    const child = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    if (entry.file && entry.name.endsWith(".md")) {
      await addDocument(state, source, child, category);
    } else if (entry.directory && category === "Instructions") {
      if (depth < MAX_RULE_DEPTH)
        await markdownDirectory(state, source, child, category, depth + 1);
      else state.limited = true;
    }
  }
}

async function readClaudeDirectory(state: ScanState, source: SourceRoot): Promise<void> {
  await addDocument(state, source, "CLAUDE.md", "Instructions");
  await markdownDirectory(state, source, "rules", "Instructions");
  for (const entry of await entries(state, source, "skills")) {
    if (!entry.directory) continue;
    await addDocument(state, source, `skills/${entry.name}/SKILL.md`, "Skills");
  }
  await markdownDirectory(state, source, "agents", "Subagents");
}

export async function loadClaudeSystem(
  panel: ClaudePanelDescriptor,
  projectId?: string | null,
): Promise<ClaudeSystemSnapshot> {
  assertSourceReadAllowed();
  const project = resolveClaudeProject(panel, projectId);
  const state: ScanState = {
    sources: [],
    bytesRemaining: MAX_TOTAL_BYTES,
    entriesRemaining: MAX_SCAN_ENTRIES,
    limited: false,
    unavailableScopes: new Set(),
    literalPaths: [
      project.workspaceRoot,
      project.sessionRoot,
      project.memoryRoot,
      panel.configuration.userRoot,
    ],
  };
  try {
    const workspace = canonicalizeDirectory(project.workspaceRoot);
    const projectSource: SourceRoot = { root: workspace, scope: "Project", prefix: "" };
    for (const filename of ["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md"]) {
      await addDocument(state, projectSource, filename, "Instructions");
    }
    try {
      const claudeRoot = canonicalizeDirectory(path.join(workspace, ".claude"));
      if (!claudeRoot.startsWith(`${workspace}${path.sep}`)) {
        throw new SourceSecurityError("path_outside_root");
      }
      if (
        claudeRoot !== path.join(workspace, ".claude") &&
        hasExcludedSegment(path.relative(workspace, claudeRoot).split(path.sep))
      ) {
        throw new SourceSecurityError("excluded_path");
      }
      await readClaudeDirectory(state, { root: claudeRoot, scope: "Project", prefix: ".claude/" });
    } catch (error) {
      if (!isMissing(error)) state.unavailableScopes.add("Project");
    }
  } catch {
    state.unavailableScopes.add("Project");
  }
  if (project.memoryRoot) {
    try {
      const root = canonicalizeDirectory(project.memoryRoot);
      await markdownDirectory(state, { root, scope: "Project", prefix: "memory/" }, "", "Memory");
    } catch {
      state.unavailableScopes.add("Memory");
    }
  }
  if (panel.configuration.userRoot) {
    try {
      const root = canonicalizeDirectory(panel.configuration.userRoot);
      await readClaudeDirectory(state, { root, scope: "User", prefix: "" });
    } catch {
      state.unavailableScopes.add("User");
    }
  }
  return claudeSystemSnapshotSchema.parse({
    sources: state.sources,
    observedAt: new Date().toISOString(),
    limited: state.limited,
    unavailableScopes: [...state.unavailableScopes],
  });
}
