import "server-only";

import { createHash } from "node:crypto";
import { fstatSync, lstatSync, readSync } from "node:fs";
import { opendir } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";

import type {
  SessionMessage,
  SessionStore,
  SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";

import {
  claudeSessionDetailSchema,
  claudeSessionPageSchema,
  type ClaudeSessionDetail,
  type ClaudeSessionPage,
  type ClaudeSessionSummary,
} from "@/contracts/claude";
import { isCredentialFilename } from "@/lib/browser-safety";
import { panelTokenCodec, type PanelTokenScope } from "@/server/panels/opaque-token";
import type { ClaudePanelDescriptor, ClaudeProjectDescriptor } from "@/server/panels/registry";
import { resolveClaudeProject } from "@/server/claude/projects";
import { classifySourceError, SourceSecurityError } from "@/server/security/errors";
import { boundUtf8Text, SOURCE_LIMITS } from "@/server/security/limits";
import {
  canonicalizeDirectory,
  resolveApprovedWorkspacePath,
  withExistingWorkspaceFile,
} from "@/server/security/path-policy";
import { cleanBrowserText, isWellFormedUnicode } from "@/server/security/safe-text";
import { assertSourceReadAllowed } from "@/server/security/prerender-guard";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const PAGE_SIZE = 5;
const MAX_FILE_BYTES = 8 * 1_024 * 1_024;
const MAX_ENTRIES = 20_000;
const MAX_MESSAGES = 250;
const MAX_ACTIVITIES = 300;
const MAX_TEXT_BYTES = 256 * 1_024;
const MAX_RESULT_BYTES = 64 * 1_024;

function scope(panel: ClaudePanelDescriptor): PanelTokenScope {
  return { panelId: panel.id, runtime: panel.runtime, adapterVersion: panel.adapterVersion };
}

function projectScope(panel: ClaudePanelDescriptor, project: ClaudeProjectDescriptor): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        project.id,
        path.resolve(project.sessionRoot),
        path.resolve(project.workspaceRoot),
        project.memoryRoot ? path.resolve(project.memoryRoot) : null,
        panel.configuration.userRoot ? path.resolve(panel.configuration.userRoot) : null,
      ]),
    )
    .digest("base64url");
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function clean(value: unknown, root: string, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = cleanBrowserText(value, { literalPaths: [root] }).text;
  return cleaned === null ? null : boundUtf8Text(cleaned, maximum * 4, maximum).text;
}

interface ReadSession {
  entries: SessionStoreEntry[];
  updatedAt: string;
  pendingWrite: boolean;
}

async function readEntries(root: string, id: string): Promise<ReadSession> {
  if (!UUID.test(id)) throw new SourceSecurityError("invalid_path");
  const filename = `${id}.jsonl`;
  if (!lstatSync(path.join(root, filename)).isFile()) {
    throw new SourceSecurityError("source_unavailable");
  }
  return withExistingWorkspaceFile(root, filename, (file) => {
    const before = fstatSync(file.descriptor);
    if (before.size > MAX_FILE_BYTES) throw new SourceSecurityError("source_too_large");
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(file.descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) throw new SourceSecurityError("source_busy");
      offset += count;
    }
    const after = fstatSync(file.descriptor);
    if (
      after.size < before.size ||
      (after.size === before.size && after.mtimeMs !== before.mtimeMs)
    ) {
      throw new SourceSecurityError("source_busy");
    }
    let text: string;
    let pendingWrite = after.size > before.size;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      if (bytes.at(-1) === 10) throw new SourceSecurityError("source_malformed");
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(
          bytes.subarray(0, bytes.lastIndexOf(10) + 1),
        );
        pendingWrite = true;
      } catch {
        throw new SourceSecurityError("source_malformed");
      }
    }
    const lines = text.split("\n");
    if (lines.length > MAX_ENTRIES + 1) throw new SourceSecurityError("source_too_large");
    const entries: SessionStoreEntry[] = [];
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        if (index === lines.length - 1 && !text.endsWith("\n")) {
          pendingWrite = true;
          continue;
        }
        throw new SourceSecurityError("source_malformed");
      }
      const entry = record(parsed);
      if (
        !entry ||
        typeof entry.type !== "string" ||
        (entry.uuid !== undefined && typeof entry.uuid !== "string") ||
        (entry.timestamp !== undefined && typeof entry.timestamp !== "string")
      ) {
        throw new SourceSecurityError("source_malformed");
      }
      entries.push(entry as SessionStoreEntry);
    }
    return { entries, updatedAt: before.mtime.toISOString(), pendingWrite };
  });
}

function readonlyStore(id: string, entries: SessionStoreEntry[]): SessionStore {
  return {
    async append() {
      throw new SourceSecurityError("unsupported_capability");
    },
    async load(key) {
      if (key.sessionId !== id || key.subpath !== undefined) return null;
      return entries;
    },
  };
}

function directoryName(cwd: unknown, root: string): string | null {
  if (typeof cwd !== "string" || !path.isAbsolute(cwd) || !isWellFormedUnicode(cwd)) return null;
  const normalized = path.resolve(cwd);
  if (
    normalized === path.parse(normalized).root ||
    normalized === homedir() ||
    normalized === root ||
    /^\/(?:Users|home)\/[^/]+\/?$/u.test(normalized) ||
    normalized === "/root"
  )
    return null;
  const label = path.basename(normalized);
  if (!label || label.startsWith(".") || label.includes("\\") || isCredentialFilename(label))
    return null;
  const cleaned = clean(label, root, 80);
  return cleaned === label ? cleaned : null;
}

async function metadata(root: string, id: string, entries: SessionStoreEntry[]) {
  const { getSessionInfo } = await import("@anthropic-ai/claude-agent-sdk");
  const info = await getSessionInfo(id, { dir: root, sessionStore: readonlyStore(id, entries) });
  return {
    title: clean(info?.customTitle || info?.summary, root, 500),
    preview: clean(info?.firstPrompt, root, 1_000),
    directoryName: directoryName(info?.cwd, root),
    gitBranch: clean(info?.gitBranch, root, 160),
  };
}

function issue(error: unknown): ClaudeSessionSummary["issue"] {
  const code = classifySourceError(error);
  return code === "source_too_large"
    ? "too_large"
    : code === "source_malformed"
      ? "malformed"
      : "unavailable";
}

export async function readClaudeSessionPage(
  panel: ClaudePanelDescriptor,
  cursor?: string | null,
  projectId?: string | null,
): Promise<ClaudeSessionPage> {
  assertSourceReadAllowed();
  const project = resolveClaudeProject(panel, projectId);
  const projectKey = projectScope(panel, project);
  const tokenScope = scope(panel);
  let after: { id: string; mtime: number } | null = null;
  if (cursor) {
    try {
      const value = record(JSON.parse(panelTokenCodec.decodeCursor(tokenScope, cursor)));
      if (
        !value ||
        value.project !== projectKey ||
        typeof value.id !== "string" ||
        !UUID.test(value.id) ||
        typeof value.mtime !== "number" ||
        !Number.isFinite(value.mtime)
      )
        throw new SourceSecurityError("invalid_path");
      after = { id: value.id, mtime: value.mtime };
    } catch {
      throw new SourceSecurityError("invalid_path");
    }
  }
  const root = canonicalizeDirectory(project.sessionRoot);
  const files: { id: string; mtime: number }[] = [];
  let scanned = 0;
  let limited = false;
  const directory = await opendir(root);
  for await (const entry of directory) {
    if (scanned >= SOURCE_LIMITS.maxDirectoryScanEntries) {
      limited = true;
      break;
    }
    scanned += 1;
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    const id = entry.name.slice(0, -6);
    if (!UUID.test(id)) continue;
    try {
      const stat = lstatSync(path.join(root, entry.name));
      if (stat.isFile()) files.push({ id, mtime: stat.mtimeMs });
    } catch {
      // A removed file is absent from this reading of the directory.
    }
  }
  files.sort((left, right) => right.mtime - left.mtime || left.id.localeCompare(right.id));
  const remaining = after
    ? files.filter(
        (file) =>
          file.mtime < after.mtime ||
          (file.mtime === after.mtime && file.id.localeCompare(after.id) > 0),
      )
    : files;
  const selected = remaining.slice(0, PAGE_SIZE);
  const items: ClaudeSessionSummary[] = [];
  for (const file of selected) {
    const id = panelTokenCodec.encodeTask(tokenScope, `${projectKey}:${file.id}`);
    try {
      const source = await readEntries(root, file.id);
      const info = await metadata(root, file.id, source.entries);
      items.push({
        id,
        title: info.title,
        preview: info.preview,
        directoryName: info.directoryName,
        gitBranch: info.gitBranch,
        updatedAt: source.updatedAt,
        issue: null,
      });
    } catch (error) {
      items.push({
        id,
        title: null,
        preview: null,
        directoryName: null,
        gitBranch: null,
        updatedAt: new Date(file.mtime).toISOString(),
        issue: issue(error),
      });
    }
  }
  return claudeSessionPageSchema.parse({
    items,
    nextCursor:
      remaining.length > PAGE_SIZE
        ? panelTokenCodec.encodeCursor(
            tokenScope,
            JSON.stringify({ ...selected.at(-1), project: projectKey }),
          )
        : null,
    observedAt: new Date().toISOString(),
    scope: "Configured Claude Code session directory",
    limited,
  });
}

function blocks(message: SessionMessage): Record<string, unknown>[] {
  const content = record(message.message)?.content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content)
    ? content.flatMap((block) => {
        const parsed = record(block);
        return parsed ? [parsed] : [];
      })
    : [];
}

function category(name: unknown): ClaudeSessionDetail["activities"][number]["category"] {
  switch (name) {
    case "Read":
      return "Read";
    case "Glob":
    case "Grep":
    case "WebSearch":
    case "WebFetch":
      return "Search";
    case "Edit":
    case "Write":
    case "MultiEdit":
    case "NotebookEdit":
      return "Edit";
    case "Bash":
      return "Command";
    case "Agent":
    case "Task":
      return "Delegation";
    default:
      return "Other";
  }
}

type Activity = ClaudeSessionDetail["activities"][number];
type PendingActivity = Pick<Activity, "key" | "messageKey" | "category" | "state"> & {
  block: Record<string, unknown>;
  recordedResult: Record<string, unknown> | undefined;
};

function approvedFile(project: ClaudeProjectDescriptor, value: unknown): string | null {
  // File tools define file_path as absolute. Text, command strings and cwd do
  // not grant access to a directory or make a relative tool path authoritative.
  if (typeof value !== "string" || !path.isAbsolute(value)) return null;
  try {
    return resolveApprovedWorkspacePath(project.workspaceRoot, value, { kind: "file" })
      .relativePath;
  } catch {
    return null;
  }
}

function recordedCommand(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // Match the complete saved command before any normalization. Adding an
  // argument, shell expression, environment assignment or script hides it.
  return /^(?:(?:pnpm|npm run) (?:test|test:browser|build|lint|typecheck|verify)|npm test|pnpm exec vitest run)$/u.test(
    value,
  )
    ? value
    : null;
}

function resultExcerpt(
  result: Record<string, unknown> | undefined,
  project: ClaudeProjectDescriptor,
): Activity["result"] {
  if (!result) return null;
  const text =
    typeof result.content === "string"
      ? result.content
      : Array.isArray(result.content)
        ? result.content
            .flatMap((value: unknown) => {
              const block = record(value);
              return block?.type === "text" && typeof block.text === "string" ? [block.text] : [];
            })
            .join("\n\n")
        : "";
  const cleaned = cleanBrowserText(text, {
    literalPaths: [project.sessionRoot, project.workspaceRoot, project.memoryRoot],
  }).text;
  if (!cleaned) return null;
  const bounded = boundUtf8Text(cleaned, 8 * 1_024, 2_000);
  return { text: bounded.text, truncated: bounded.truncated };
}

function activityEvidence(
  block: Record<string, unknown>,
  result: Record<string, unknown> | undefined,
  project: ClaudeProjectDescriptor,
): Pick<Activity, "label" | "filePath" | "command" | "result"> {
  const input = record(block.input);
  const evidence: Pick<Activity, "label" | "filePath" | "command" | "result"> = {
    label: "Other tool",
    filePath: null,
    command: null,
    result: null,
  };
  switch (block.name) {
    case "Read":
    case "Edit":
    case "Write": {
      evidence.filePath = approvedFile(project, input?.file_path);
      evidence.label = evidence.filePath
        ? boundUtf8Text(`${block.name} ${evidence.filePath}`, 960, 240).text
        : `${block.name} file`;
      if (evidence.filePath) evidence.result = resultExcerpt(result, project);
      break;
    }
    case "Bash":
      evidence.label = "Recorded command";
      evidence.command = recordedCommand(input?.command);
      if (evidence.command) evidence.result = resultExcerpt(result, project);
      break;
    case "Agent": {
      const description = clean(input?.description, project.sessionRoot, 200);
      evidence.label = description ? `Delegate: ${description}` : "Delegate work";
      if (description) evidence.result = resultExcerpt(result, project);
      break;
    }
    case "Glob":
      evidence.label = "Search filenames";
      break;
    case "Grep":
      evidence.label = "Search file contents";
      break;
    case "WebSearch":
    case "WebFetch":
      evidence.label = "Search the web";
      break;
    default:
      break;
  }
  return evidence;
}

export async function readClaudeSession(
  panel: ClaudePanelDescriptor,
  token: string,
  projectId?: string | null,
): Promise<ClaudeSessionDetail> {
  assertSourceReadAllowed();
  const project = resolveClaudeProject(panel, projectId);
  const projectKey = projectScope(panel, project);
  const rawId = panelTokenCodec.decodeTask(scope(panel), token);
  if (!rawId.startsWith(`${projectKey}:`)) throw new SourceSecurityError("invalid_path");
  const id = rawId.slice(projectKey.length + 1);
  const root = canonicalizeDirectory(project.sessionRoot);
  const source = await readEntries(root, id);
  const { getSessionMessages } = await import("@anthropic-ai/claude-agent-sdk");
  const messages = await getSessionMessages(id, {
    dir: root,
    sessionStore: readonlyStore(id, source.entries),
    includeSystemMessages: true,
  });
  const byId = new Map(
    source.entries.filter((entry) => entry.uuid).map((entry) => [entry.uuid, entry]),
  );
  const visible: ClaudeSessionDetail["messages"] = [];
  const activities: PendingActivity[] = [];
  const results = new Map<string, Record<string, unknown>>();
  for (const message of messages) {
    for (const block of blocks(message)) {
      if (
        message.type === "user" &&
        block.type === "tool_result" &&
        typeof block.tool_use_id === "string"
      ) {
        results.set(block.tool_use_id, block);
      }
    }
  }
  let limited = false;
  for (const message of messages) {
    const raw = byId.get(message.uuid);
    const summary = raw?.isCompactSummary === true;
    if (message.type === "system" || (raw?.isMeta === true && !summary)) continue;
    const contentBlocks = blocks(message);
    const toolBlocks =
      message.type === "assistant" && !summary
        ? contentBlocks.filter((block) => block.type === "tool_use")
        : [];
    const text = contentBlocks
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n\n");
    const cleaned = cleanBrowserText(text, { literalPaths: [root] }).text;
    if (!cleaned && toolBlocks.length === 0) continue;
    const bounded = cleaned ? boundUtf8Text(cleaned, 64 * 1_024, 20_000) : null;
    limited ||= bounded?.truncated ?? false;
    const messageKey = `message-${visible.length + 1}`;
    visible.push({
      key: messageKey,
      role: summary ? "summary" : message.type,
      content: bounded?.text ?? null,
      timestamp: timestamp(raw?.timestamp),
    });
    for (const block of toolBlocks) {
      const result = typeof block.id === "string" ? results.get(block.id) : undefined;
      activities.push({
        key: `activity-${activities.length + 1}`,
        messageKey,
        category: category(block.name),
        state: !result
          ? "no_result_recorded"
          : result.is_error === true
            ? "recorded_error"
            : "result_recorded",
        block,
        recordedResult: result,
      });
    }
  }
  limited ||= activities.length > MAX_ACTIVITIES;
  const retainedActivities = activities
    .slice(-MAX_ACTIVITIES)
    .map(({ block, recordedResult, ...activity }) => ({
      ...activity,
      ...activityEvidence(block, recordedResult, project),
    }));
  let resultBytes = 0;
  for (const activity of retainedActivities.toReversed()) {
    const size = Buffer.byteLength(activity.result?.text ?? "", "utf8");
    if (resultBytes + size > MAX_RESULT_BYTES) {
      activity.result = null;
      limited = true;
    } else {
      resultBytes += size;
      limited ||= activity.result?.truncated ?? false;
    }
  }
  const activityMessageKeys = new Set(retainedActivities.map((activity) => activity.messageKey));
  const displayed: ClaudeSessionDetail["messages"] = [];
  let bytes = 0;
  for (const message of visible.toReversed()) {
    if (message.content === null && !activityMessageKeys.has(message.key)) continue;
    const size = Buffer.byteLength(message.content ?? "", "utf8");
    if (displayed.length >= MAX_MESSAGES || bytes + size > MAX_TEXT_BYTES) {
      limited = true;
      break;
    }
    displayed.push(message);
    bytes += size;
  }
  const displayedKeys = new Set(displayed.map((message) => message.key));
  const info = await metadata(root, id, source.entries);
  return claudeSessionDetailSchema.parse({
    id: token,
    title: info.title,
    directoryName: info.directoryName,
    gitBranch: info.gitBranch,
    messages: displayed.reverse(),
    activities: retainedActivities.map((activity) => ({
      ...activity,
      messageKey: displayedKeys.has(activity.messageKey!) ? activity.messageKey : null,
    })),
    observedAt: new Date().toISOString(),
    updatedAt: source.updatedAt,
    limited,
    pendingWrite: source.pendingWrite,
  });
}
