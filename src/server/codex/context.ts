import "server-only";

import { constants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import path from "node:path";

import type { CodexPanelDescriptor } from "@/server/panels/registry";
import { SourceSecurityError } from "@/server/security/errors";

const STARTUP_PATH = process.env.PATH ?? "";
const EXECUTABLE_NAME = "codex";
const STATE_DATABASE_NAME = "state_5.sqlite";
const ROLLOUT_DIRECTORY_NAMES = Object.freeze(["sessions", "archived_sessions"] as const);
const MAX_STARTUP_PATH_BYTES = 16 * 1024;
const MAX_PATH_ENTRIES = 64;
const MAX_PATH_CHARACTERS = 4_096;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;

export interface ResolvedCodexSource {
  readonly stateDatabase: string;
  readonly rolloutRoots: readonly string[];
}

export type CodexSourceKind = "list" | "read";

export interface CodexContextResolver {
  resolveExecutable(panel: CodexPanelDescriptor): Promise<string>;
  resolveSource(panel: CodexPanelDescriptor, kind: CodexSourceKind): Promise<ResolvedCodexSource>;
}

function fail(code: "missing_source" | "source_malformed" | "source_unavailable"): never {
  throw new SourceSecurityError(code);
}

function effectiveUid(): number {
  if (process.platform !== "darwin" && process.platform !== "linux") fail("source_unavailable");
  if (typeof process.geteuid !== "function") fail("source_unavailable");
  return process.geteuid();
}

function isContained(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function assertFixedPanel(panel: CodexPanelDescriptor): void {
  if (
    panel.id !== "codex" ||
    panel.name !== "Codex" ||
    panel.runtime !== "codex" ||
    panel.adapterVersion !== "codex-0.145.0"
  ) {
    fail("source_malformed");
  }
}

async function resolveHome(configuredHome: string, uid: number): Promise<string> {
  try {
    const canonical = await realpath(configuredHome);
    const stat = await lstat(canonical);
    if (
      !path.isAbsolute(canonical) ||
      canonical === path.parse(canonical).root ||
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.uid !== uid
    ) {
      fail("source_unavailable");
    }
    return canonical;
  } catch (error) {
    if (error instanceof SourceSecurityError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") fail("missing_source");
    fail("source_unavailable");
  }
}

async function resolveStateDatabase(home: string, uid: number): Promise<string> {
  const candidate = path.join(home, STATE_DATABASE_NAME);
  let stat;
  try {
    stat = await lstat(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") fail("missing_source");
    fail("source_unavailable");
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== uid) fail("source_unavailable");
  try {
    const canonical = await realpath(candidate);
    if (!isContained(home, candidate) || canonical !== candidate) fail("source_unavailable");
    return candidate;
  } catch (error) {
    if (error instanceof SourceSecurityError) throw error;
    fail("source_unavailable");
  }
}

async function resolveRolloutRoots(home: string, uid: number): Promise<readonly string[]> {
  const roots: string[] = [];
  for (const name of ROLLOUT_DIRECTORY_NAMES) {
    const candidate = path.join(home, name);
    let stat;
    try {
      stat = await lstat(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      fail("source_unavailable");
    }
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid)
      fail("source_unavailable");
    try {
      const canonical = await realpath(candidate);
      if (!isContained(home, candidate) || canonical !== candidate) fail("source_unavailable");
      roots.push(candidate);
    } catch (error) {
      if (error instanceof SourceSecurityError) throw error;
      fail("source_unavailable");
    }
  }
  return Object.freeze(roots);
}

async function resolveExecutable(startupPath: string): Promise<string> {
  if (process.platform !== "darwin" && process.platform !== "linux") fail("source_unavailable");
  if (Buffer.byteLength(startupPath) > MAX_STARTUP_PATH_BYTES) fail("source_unavailable");
  const entries = startupPath.split(path.delimiter);
  if (entries.length > MAX_PATH_ENTRIES) fail("source_unavailable");
  const seen = new Set<string>();
  for (const entry of entries) {
    if (
      !entry ||
      entry.length > MAX_PATH_CHARACTERS ||
      CONTROL_CHARACTERS.test(entry) ||
      !path.isAbsolute(entry) ||
      path.normalize(entry) !== entry
    ) {
      continue;
    }
    const candidate = path.join(entry, EXECUTABLE_NAME);
    try {
      const canonical = await realpath(candidate);
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      const stat = await lstat(canonical);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      await access(canonical, constants.X_OK);
      return canonical;
    } catch {
      // Match executable lookup semantics: continue to the next safe PATH entry.
    }
  }
  fail("missing_source");
}

function createResolver(startupPath: string): CodexContextResolver {
  return Object.freeze({
    async resolveExecutable(panel: CodexPanelDescriptor) {
      assertFixedPanel(panel);
      return resolveExecutable(startupPath);
    },
    async resolveSource(panel: CodexPanelDescriptor, kind: CodexSourceKind) {
      assertFixedPanel(panel);
      if (kind !== "list" && kind !== "read") fail("source_malformed");
      const uid = effectiveUid();
      const home = await resolveHome(panel.configuration.home, uid);
      const stateDatabase = await resolveStateDatabase(home, uid);
      const rolloutRoots =
        kind === "read" ? await resolveRolloutRoots(home, uid) : Object.freeze([] as string[]);
      return Object.freeze({ stateDatabase, rolloutRoots });
    },
  });
}

export const codexContextResolver: CodexContextResolver = createResolver(STARTUP_PATH);

/** Test-only startup-PATH seam. Production always uses the module-load snapshot. */
export function createCodexContextResolverForTest(startupPath: string): CodexContextResolver {
  if (process.env.NODE_ENV !== "test") fail("source_unavailable");
  return createResolver(startupPath);
}
