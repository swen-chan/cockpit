import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createPanelTokenCodec, type PanelTokenScope } from "@/server/panels/opaque-token";
import {
  resolvePanel,
  resolvePanelRegistry,
  type HermesPanelDescriptor,
} from "@/server/panels/registry";
import {
  createScopedHermesConversationIdentityCodec,
  scopedHermesConversationOptions,
  scopedHermesFilesOptions,
  scopedHermesJobsOptions,
  scopedHermesSkillOptions,
  scopedHermesSystemOptions,
} from "@/server/services/hermes-scoped";
import { loadConversationPage, loadConversationTranscript } from "@/server/services/conversations";
import {
  createHermesFixture,
  removeHermesFixture,
  type HermesFixture,
} from "../helpers/hermes-fixture";

const missingRoot = "/definitely-not-present/cockpit-hermes-scoped";

function hermesPanel(
  environment: Readonly<Record<string, string | undefined>>,
): HermesPanelDescriptor {
  const panel = resolvePanel(resolvePanelRegistry(environment), "hermes");
  if (panel.runtime !== "hermes") throw new Error("Expected a Hermes panel fixture.");
  return panel;
}

function scope(panel: HermesPanelDescriptor): PanelTokenScope {
  return {
    panelId: panel.id,
    runtime: panel.runtime,
    adapterVersion: panel.adapterVersion,
  };
}

describe("scoped Hermes service inputs", () => {
  const fixtures: HermesFixture[] = [];

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const fixture of fixtures.splice(0)) removeHermesFixture(fixture);
  });

  it("derives minimal private options from a scoped descriptor without ambient environment", () => {
    const fixture = createHermesFixture("cockpit-hermes-scoped-options-");
    fixtures.push(fixture);
    vi.stubEnv("COCKPIT_SOURCE_MANIFEST", "/ambient/private-manifest.json");
    vi.stubEnv("HERMES_HOME", "/ambient/hermes-home");
    const panel = hermesPanel({
      COCKPIT_WORKSPACE_ROOT: fixture.workspace,
      COCKPIT_SOURCE_PRESET: "hermes-v2026.9.11",
      COCKPIT_HERMES_HOME: fixture.home,
      COCKPIT_CODEX_HOME: path.join(fixture.root, "codex-home"),
    });

    const conversations = scopedHermesConversationOptions(panel);
    const system = scopedHermesSystemOptions(panel);
    const jobs = scopedHermesJobsOptions(panel);
    const skill = scopedHermesSkillOptions(panel);
    const files = scopedHermesFilesOptions(panel);

    expect(conversations.environment).toEqual({
      COCKPIT_HERMES_HOME: fixture.home,
      COCKPIT_SOURCE_PRESET: "hermes-v2026.9.11",
    });
    expect(system.environment).toEqual({
      COCKPIT_HERMES_HOME: fixture.home,
      COCKPIT_SOURCE_PRESET: "hermes-v2026.9.11",
      COCKPIT_WORKSPACE_ROOT: fixture.workspace,
    });
    expect(jobs.environment).toEqual(conversations.environment);
    expect(skill.environment).toEqual({ COCKPIT_HERMES_HOME: fixture.home });
    expect(files).toEqual({ workspaceRoot: fixture.workspace });
    expect(JSON.stringify({ conversations, system, jobs, skill, files })).not.toContain(
      "ambient/private-manifest",
    );
    expect(JSON.stringify({ conversations, system, jobs, skill, files })).not.toContain(
      "ambient/hermes-home",
    );
    expect(Object.isFrozen(conversations)).toBe(true);
    expect(Object.isFrozen(conversations.environment)).toBe(true);
    expect(Object.isFrozen(files)).toBe(true);
  });

  it("uses an explicit manifest selector without retaining the preset or Codex roots", () => {
    const panel = hermesPanel({
      COCKPIT_WORKSPACE_ROOT: `${missingRoot}/workspace`,
      COCKPIT_SOURCE_MANIFEST: `${missingRoot}/private-manifest.json`,
      COCKPIT_HERMES_HOME: `${missingRoot}/home`,
      COCKPIT_CODEX_HOME: `${missingRoot}/codex-home`,
      COCKPIT_CODEX_WORKSPACE_ROOT: `${missingRoot}/codex-workspace`,
    });

    expect(scopedHermesJobsOptions(panel).environment).toEqual({
      COCKPIT_HERMES_HOME: `${missingRoot}/home`,
      COCKPIT_SOURCE_MANIFEST: `${missingRoot}/private-manifest.json`,
    });
    expect(JSON.stringify(scopedHermesSystemOptions(panel))).not.toContain("codex");
  });

  it("pins the selected HERMES_HOME fallback into minimal scoped reader options", () => {
    const selectedHome = `${missingRoot}/selected-hermes-home`;
    const panel = hermesPanel({
      COCKPIT_WORKSPACE_ROOT: `${missingRoot}/workspace`,
      COCKPIT_SOURCE_PRESET: "hermes-v2026.9.11",
      HERMES_HOME: selectedHome,
      COCKPIT_CODEX_HOME: `${missingRoot}/codex-home`,
    });

    expect(scopedHermesConversationOptions(panel).environment).toEqual({
      COCKPIT_HERMES_HOME: selectedHome,
      COCKPIT_SOURCE_PRESET: "hermes-v2026.9.11",
    });
    expect(scopedHermesSkillOptions(panel).environment).toEqual({
      COCKPIT_HERMES_HOME: selectedHome,
    });
  });

  it("keeps an explicit legacy fallback while still panel-binding scoped history tokens", () => {
    const panel = hermesPanel({});
    const conversations = scopedHermesConversationOptions(panel);

    expect(scopedHermesSystemOptions(panel)).toEqual({});
    expect(scopedHermesJobsOptions(panel)).toEqual({});
    expect(scopedHermesSkillOptions(panel)).toEqual({});
    expect(scopedHermesFilesOptions(panel)).toEqual({});
    expect(Object.keys(conversations)).toEqual(["identityCodec"]);
    expect(conversations.identityCodec.encodeTask("synthetic-id", 1)).toMatch(/^task-/u);
  });

  it("uses raw task IDs only and a strict rawId/time cursor payload", () => {
    const panel = hermesPanel({});
    const tokens = createPanelTokenCodec(new Uint8Array(32).fill(21));
    const identity = createScopedHermesConversationIdentityCodec(panel, tokens);
    const panelScope = scope(panel);

    const task = identity.encodeTask("synthetic-raw-id", 123);
    expect(tokens.decodeTask(panelScope, task)).toBe("synthetic-raw-id");
    expect(identity.decodeTask(task)).toBe("synthetic-raw-id");

    const cursor = identity.encodeCursor("synthetic-raw-id", 123);
    expect(JSON.parse(tokens.decodeCursor(panelScope, cursor))).toEqual({
      rawId: "synthetic-raw-id",
      time: 123,
    });
    expect(identity.decodeCursor(cursor)).toEqual({ rawId: "synthetic-raw-id", time: 123 });

    for (const malformed of [
      { rawId: "synthetic-raw-id" },
      { rawId: "synthetic-raw-id", time: 123, extra: true },
      { rawId: "", time: 123 },
      { rawId: "synthetic-raw-id", time: 0 },
      ["synthetic-raw-id", 123],
    ]) {
      const token = tokens.encodeCursor(panelScope, JSON.stringify(malformed));
      expect(() => identity.decodeCursor(token)).toThrowError(
        expect.objectContaining({ code: "invalid_path" }),
      );
    }
  });

  it("round-trips scoped task and cursor tokens while leaving legacy tokens unchanged", async () => {
    const fixture = createHermesFixture("cockpit-hermes-scoped-history-");
    fixtures.push(fixture);
    const panel = hermesPanel({
      COCKPIT_WORKSPACE_ROOT: fixture.workspace,
      COCKPIT_SOURCE_PRESET: "hermes-v2026.9.11",
      COCKPIT_HERMES_HOME: fixture.home,
      COCKPIT_CODEX_HOME: path.join(fixture.root, "codex-home"),
    });
    const tokens = createPanelTokenCodec(new Uint8Array(32).fill(22));
    const options = scopedHermesConversationOptions(panel, tokens);

    const first = await loadConversationPage(null, 5, options);
    expect(first.items).toHaveLength(5);
    expect(first.items.every((item) => item.id.startsWith("task-"))).toBe(true);
    expect(first.nextCursor).toMatch(/^cursor-/u);
    expect(JSON.stringify(first)).not.toContain("RAW_SESSION_ID_MARKER");
    expect(tokens.decodeTask(scope(panel), first.items[0]!.id)).toBe("RAW_SESSION_ID_MARKER_1");

    const decodedCursor = JSON.parse(tokens.decodeCursor(scope(panel), first.nextCursor!));
    expect(Object.keys(decodedCursor).sort()).toEqual(["rawId", "time"]);
    expect(decodedCursor).toMatchObject({ rawId: "RAW_SESSION_ID_MARKER_5" });
    const second = await loadConversationPage(first.nextCursor, 5, options);
    expect(second.items.map((item) => item.title)).toEqual(["Synthetic conversation 6"]);
    const detail = await loadConversationTranscript(first.items[0]!.id, options);
    expect(detail.id).toBe(first.items[0]!.id);
    expect(detail.messages.map((message) => message.role)).toEqual(["user", "tool", "assistant"]);

    const legacy = await loadConversationPage(null, 1, {
      environment: fixture.environment,
      platformRoot: fixture.home,
    });
    expect(legacy.items[0]?.id).toMatch(/^conversation-/u);
  });

  it("rejects forged scoped selectors before resolving a missing home, manifest, or database", async () => {
    const panel = hermesPanel({
      COCKPIT_WORKSPACE_ROOT: `${missingRoot}/workspace`,
      COCKPIT_SOURCE_MANIFEST: `${missingRoot}/private-manifest.json`,
      COCKPIT_HERMES_HOME: `${missingRoot}/home`,
      COCKPIT_CODEX_HOME: `${missingRoot}/codex-home`,
    });
    const options = scopedHermesConversationOptions(
      panel,
      createPanelTokenCodec(new Uint8Array(32).fill(23)),
    );

    await expect(loadConversationPage("cursor-forged", 5, options)).rejects.toMatchObject({
      code: "invalid_path",
    });
    await expect(loadConversationTranscript("task-forged", options)).rejects.toMatchObject({
      code: "invalid_path",
    });

    const validTask = options.identityCodec.encodeTask("synthetic-id", 1);
    await expect(loadConversationTranscript(validTask, options)).rejects.toMatchObject({
      code: "missing_source",
    });
  });
});
