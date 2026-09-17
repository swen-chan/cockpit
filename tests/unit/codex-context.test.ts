// @vitest-environment node
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCodexContextResolverForTest } from "@/server/codex/context";
import type { CodexPanelDescriptor } from "@/server/panels/registry";
import { resolvePanel, resolvePanelRegistry } from "@/server/panels/registry";

function panel(home: string): CodexPanelDescriptor {
  const resolved = resolvePanel(resolvePanelRegistry({ COCKPIT_CODEX_HOME: home }), "codex");
  if (resolved.runtime !== "codex") throw new Error("synthetic panel mismatch");
  return resolved;
}

describe("Codex lazy trusted context", () => {
  let fixture: string;
  let home: string;
  let sessions: string;
  let executableDirectory: string;
  let executable: string;

  beforeEach(() => {
    fixture = realpathSync(mkdtempSync(path.join(realpathSync("/tmp"), "cockpit-codex-context-")));
    chmodSync(fixture, 0o700);
    home = path.join(fixture, "home");
    sessions = path.join(home, "sessions");
    executableDirectory = path.join(fixture, "bin");
    executable = path.join(executableDirectory, "codex");
    mkdirSync(sessions, { recursive: true, mode: 0o700 });
    mkdirSync(executableDirectory, { mode: 0o700 });
    writeFileSync(path.join(home, "state_5.sqlite"), "synthetic state", { mode: 0o600 });
    writeFileSync(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    chmodSync(executable, 0o700);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(fixture, { recursive: true, force: true });
  });

  it("canonicalizes the configured home and returns only existing safe rollout roots", async () => {
    const configuredHome = path.join(fixture, "configured-home");
    symlinkSync(home, configuredHome);
    const resolve = createCodexContextResolverForTest(executableDirectory);

    const resolvedPanel = panel(configuredHome);
    const executablePath = await resolve.resolveExecutable(resolvedPanel);
    const source = await resolve.resolveSource(resolvedPanel, "read");

    expect({ ...source, executable: executablePath }).toEqual({
      stateDatabase: path.join(home, "state_5.sqlite"),
      rolloutRoots: [sessions],
      executable,
    });
    expect(Object.isFrozen(source)).toBe(true);
    expect(Object.isFrozen(source.rolloutRoots)).toBe(true);
  });

  it("resolves only the hardcoded executable name from bounded absolute PATH entries", async () => {
    rmSync(executable);
    writeFileSync(path.join(executableDirectory, "codex-other"), "synthetic", { mode: 0o700 });
    const resolve = createCodexContextResolverForTest(
      `relative${path.delimiter}${executableDirectory}`,
    );

    await expect(resolve.resolveExecutable(panel(home))).rejects.toMatchObject({
      code: "missing_source",
    });
  });

  it("reports a missing configured home without probing alternate locations", async () => {
    const resolve = createCodexContextResolverForTest(executableDirectory);
    await expect(
      resolve.resolveSource(panel(path.join(fixture, "missing-home")), "list"),
    ).rejects.toMatchObject({ code: "missing_source" });
  });

  it("always rejects an unsafe state database but checks rollout roots only for detail reads", async () => {
    const state = path.join(home, "state_5.sqlite");
    const target = path.join(fixture, "foreign-state");
    writeFileSync(target, "foreign", { mode: 0o600 });
    rmSync(state);
    symlinkSync(target, state);
    const resolve = createCodexContextResolverForTest(executableDirectory);
    await expect(resolve.resolveSource(panel(home), "list")).rejects.toMatchObject({
      code: "source_unavailable",
    });

    rmSync(state);
    writeFileSync(state, "synthetic state", { mode: 0o600 });
    rmSync(sessions, { recursive: true });
    const foreignSessions = path.join(fixture, "foreign-sessions");
    mkdirSync(foreignSessions, { mode: 0o700 });
    symlinkSync(foreignSessions, sessions);
    await expect(resolve.resolveSource(panel(home), "list")).resolves.toEqual({
      stateDatabase: state,
      rolloutRoots: [],
    });
    await expect(resolve.resolveSource(panel(home), "read")).rejects.toMatchObject({
      code: "source_unavailable",
    });
  });

  it("requires the selected home and state file to belong to the effective user", async () => {
    const uid = process.geteuid!();
    vi.spyOn(process, "geteuid").mockReturnValue(uid + 1);
    const resolve = createCodexContextResolverForTest(executableDirectory);

    await expect(resolve.resolveSource(panel(home), "list")).rejects.toMatchObject({
      code: "source_unavailable",
    });
  });
});
