import { describe, expect, it } from "vitest";

import {
  chooseInitialPanelId,
  requirePanelSurface,
  resolvePanel,
  resolvePanelRegistry,
  type PanelRegistry,
} from "@/server/panels/registry";

const missingRoot = "/definitely-not-present/cockpit-fixture";
const hermesConfiguration = {
  COCKPIT_WORKSPACE_ROOT: `${missingRoot}/hermes-workspace`,
  COCKPIT_SOURCE_PRESET: "hermes-v2026.9.11",
};

function readyRegistry(environment: Readonly<Record<string, string | undefined>>): PanelRegistry {
  const registry = resolvePanelRegistry(environment);
  expect(registry.state).toBe("ready");
  if (registry.state !== "ready") throw new Error("Expected a configured registry.");
  return registry;
}

describe("fixed Agent panel registry", () => {
  it("reports no configured Agent without activating an ambient Hermes home", () => {
    expect(resolvePanelRegistry({})).toEqual({ state: "unconfigured" });
    expect(resolvePanelRegistry({ HERMES_HOME: `${missingRoot}/ambient-hermes` })).toEqual({
      state: "unconfigured",
    });
  });

  it("resolves the same Hermes configuration alone or alongside Codex", () => {
    const alone = readyRegistry(hermesConfiguration);
    const dual = readyRegistry({
      ...hermesConfiguration,
      COCKPIT_CODEX_HOME: `${missingRoot}/codex`,
    });
    expect(alone.panels).toHaveLength(1);
    expect(alone.defaultPanelId).toBe("hermes");
    expect(resolvePanel(alone, "hermes")).toEqual(resolvePanel(dual, "hermes"));
    expect(alone.publicPanels[0]?.surfaces).toEqual([
      "overview",
      "system",
      "conversations",
      "files",
      "jobs",
    ]);
  });

  it("constructs Codex-only panels from structural paths without touching the filesystem", () => {
    const withoutWorkspace = readyRegistry({ COCKPIT_CODEX_HOME: `${missingRoot}/codex-home` });
    expect(withoutWorkspace.defaultPanelId).toBe("codex");
    expect(withoutWorkspace.panels).toHaveLength(1);
    expect(withoutWorkspace.publicPanels[0]?.surfaces).toEqual([
      "overview",
      "system",
      "conversations",
    ]);
    const withWorkspace = readyRegistry({
      COCKPIT_CODEX_HOME: `${missingRoot}/codex-home`,
      COCKPIT_CODEX_WORKSPACE_ROOT: `${missingRoot}/workspace`,
      COCKPIT_CODEX_CUSTOM_GUIDANCE: "guidance/SOUL.md",
    });
    expect(withWorkspace.publicPanels[0]?.surfaces).toEqual([
      "overview",
      "system",
      "conversations",
      "files",
    ]);
    expect(withWorkspace.publicPanels[0]?.surfaces).not.toContain("jobs");
  });

  it("constructs a stable dual registry and honors only a configured default", () => {
    const registry = readyRegistry({
      ...hermesConfiguration,
      COCKPIT_HERMES_HOME: `${missingRoot}/hermes-home`,
      COCKPIT_CODEX_HOME: `${missingRoot}/codex-home`,
      COCKPIT_DEFAULT_PANEL: "codex",
    });
    expect(registry.panels.map(({ id }) => id)).toEqual(["hermes", "codex"]);
    expect(registry.defaultPanelId).toBe("codex");
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.panels)).toBe(true);
    expect(Object.isFrozen(registry.publicPanels[0]?.surfaces)).toBe(true);
  });

  it("captures the documented Hermes home only for an explicitly configured Hermes panel", () => {
    const ambientHermesHome = `${missingRoot}/ambient-hermes-home`;
    const cockpitHermesHome = `${missingRoot}/cockpit-hermes-home`;
    const fallback = resolvePanel(
      resolvePanelRegistry({ ...hermesConfiguration, HERMES_HOME: ambientHermesHome }),
      "hermes",
    );
    expect(fallback.configuration).toMatchObject({ explicitHome: ambientHermesHome });
    const preferred = resolvePanel(
      resolvePanelRegistry({
        ...hermesConfiguration,
        COCKPIT_HERMES_HOME: cockpitHermesHome,
        HERMES_HOME: ambientHermesHome,
      }),
      "hermes",
    );
    expect(preferred.configuration).toMatchObject({ explicitHome: cockpitHermesHome });
    expect(
      readyRegistry({
        COCKPIT_CODEX_HOME: `${missingRoot}/codex-home`,
        HERMES_HOME: ambientHermesHome,
      }).panels.map(({ id }) => id),
    ).toEqual(["codex"]);
  });

  it("keeps private configuration out of public summaries", () => {
    const secrets = [
      `${missingRoot}/hermes-workspace`,
      `${missingRoot}/manifest-private.json`,
      `${missingRoot}/hermes-home`,
      `${missingRoot}/codex-home`,
      `${missingRoot}/codex-workspace`,
      "private/SOUL.md",
    ];
    const registry = readyRegistry({
      COCKPIT_WORKSPACE_ROOT: secrets[0],
      COCKPIT_SOURCE_MANIFEST: secrets[1],
      COCKPIT_HERMES_HOME: secrets[2],
      COCKPIT_CODEX_HOME: secrets[3],
      COCKPIT_CODEX_WORKSPACE_ROOT: secrets[4],
      COCKPIT_CODEX_CUSTOM_GUIDANCE: secrets[5],
    });
    const serialized = JSON.stringify(registry.publicPanels);
    for (const secret of secrets) expect(serialized).not.toContain(secret);
    expect(serialized).not.toMatch(/(?:manifest|guidance|home|root|executable|token)/iu);
  });

  it.each([
    [{ COCKPIT_CODEX_WORKSPACE_ROOT: `${missingRoot}/workspace` }, "COCKPIT_CODEX_HOME"],
    [{ COCKPIT_CODEX_CUSTOM_GUIDANCE: "SOUL.md" }, "COCKPIT_CODEX_HOME"],
    [{ COCKPIT_CODEX_HOME: "relative/codex" }, "COCKPIT_CODEX_HOME"],
    [{ COCKPIT_CODEX_HOME: "/" }, "COCKPIT_CODEX_HOME"],
    [
      { COCKPIT_CODEX_HOME: `${missingRoot}/codex`, COCKPIT_CODEX_CUSTOM_GUIDANCE: "SOUL.md" },
      "COCKPIT_CODEX_WORKSPACE_ROOT",
    ],
    [
      {
        COCKPIT_CODEX_HOME: `${missingRoot}/codex`,
        COCKPIT_CODEX_WORKSPACE_ROOT: "relative/workspace",
      },
      "COCKPIT_CODEX_WORKSPACE_ROOT",
    ],
    [
      {
        COCKPIT_CODEX_HOME: `${missingRoot}/codex`,
        COCKPIT_CODEX_WORKSPACE_ROOT: `${missingRoot}/workspace`,
        COCKPIT_CODEX_CUSTOM_GUIDANCE: "../SOUL.md",
      },
      "COCKPIT_CODEX_CUSTOM_GUIDANCE",
    ],
    [
      {
        COCKPIT_CODEX_HOME: `${missingRoot}/codex`,
        COCKPIT_CODEX_WORKSPACE_ROOT: `${missingRoot}/workspace`,
        COCKPIT_CODEX_CUSTOM_GUIDANCE: "/SOUL.md",
      },
      "COCKPIT_CODEX_CUSTOM_GUIDANCE",
    ],
    [{ COCKPIT_WORKSPACE_ROOT: `${missingRoot}/hermes` }, "COCKPIT_SOURCE_PRESET"],
    [
      { COCKPIT_WORKSPACE_ROOT: `${missingRoot}/hermes`, COCKPIT_SOURCE_PRESET: "unknown-preset" },
      "COCKPIT_SOURCE_PRESET",
    ],
    [{ COCKPIT_SOURCE_PRESET: "hermes-v2026.9.11" }, "COCKPIT_WORKSPACE_ROOT"],
    [
      {
        COCKPIT_WORKSPACE_ROOT: `${missingRoot}/hermes`,
        COCKPIT_SOURCE_PRESET: "one",
        COCKPIT_SOURCE_MANIFEST: `${missingRoot}/two.json`,
      },
      "COCKPIT_SOURCE_PRESET",
    ],
    [
      { COCKPIT_WORKSPACE_ROOT: `${missingRoot}/hermes`, COCKPIT_SOURCE_MANIFEST: "/" },
      "COCKPIT_SOURCE_MANIFEST",
    ],
    [
      { COCKPIT_CODEX_HOME: `${missingRoot}/codex`, COCKPIT_DEFAULT_PANEL: "hermes" },
      "COCKPIT_DEFAULT_PANEL",
    ],
    [{ COCKPIT_CODEX_HOME: `${missingRoot}/codex\nchild` }, "COCKPIT_CODEX_HOME"],
    [{ COCKPIT_CODEX_HOME: `${missingRoot}/codex\n` }, "COCKPIT_CODEX_HOME"],
    [{ COCKPIT_CODEX_HOME: `${missingRoot}/codex ` }, "COCKPIT_CODEX_HOME"],
    [{ COCKPIT_CODEX_HOME: " " }, "COCKPIT_CODEX_HOME"],
    [
      { COCKPIT_CODEX_HOME: `${missingRoot}/codex`, COCKPIT_DEFAULT_PANEL: " codex " },
      "COCKPIT_DEFAULT_PANEL",
    ],
  ])("reports a fixed configuration key for invalid input %#", (environment, key) => {
    expect(resolvePanelRegistry(environment)).toMatchObject({ state: "invalid", key });
  });

  it("does not echo an invalid configuration value", () => {
    const marker = "PRIVATE_CONFIGURATION_MARKER";
    const result = resolvePanelRegistry({ ...hermesConfiguration, COCKPIT_WORKSPACE_ROOT: marker });
    expect(result).toEqual({
      state: "invalid",
      key: "COCKPIT_WORKSPACE_ROOT",
      requirement: "Use an absolute path other than the filesystem root.",
    });
    expect(JSON.stringify(result)).not.toContain(marker);
  });

  it("resolves remembered/default panels without using availability as a fallback", () => {
    const registry = readyRegistry({
      ...hermesConfiguration,
      COCKPIT_CODEX_HOME: `${missingRoot}/codex`,
      COCKPIT_DEFAULT_PANEL: "codex",
    });
    expect(chooseInitialPanelId(registry, "hermes")).toBe("hermes");
    expect(chooseInitialPanelId(registry, "removed-panel")).toBe("codex");
    expect(chooseInitialPanelId(registry, null)).toBe("codex");
  });

  it("rejects unknown panels and unsupported capabilities without fallback", () => {
    const registry = readyRegistry({ COCKPIT_CODEX_HOME: `${missingRoot}/codex` });
    expect(() => resolvePanel(registry, "hermes")).toThrowError(
      expect.objectContaining({ code: "invalid_panel" }),
    );
    expect(() => resolvePanel(registry, "../../hermes")).toThrowError(
      expect.objectContaining({ code: "invalid_panel" }),
    );
    expect(() => requirePanelSurface(resolvePanel(registry, "codex"), "jobs")).toThrowError(
      expect.objectContaining({ code: "unsupported_capability" }),
    );
  });
});

it("enables Claude project surfaces from explicit project configuration", () => {
  const root = `${missingRoot}/claude-project`;
  const projects = JSON.stringify([
    { id: "project", name: "Project", sessionRoot: root, workspaceRoot: `${root}/workspace` },
  ]);
  const alone = readyRegistry({ COCKPIT_CLAUDE_PROJECTS: projects });
  expect(alone.defaultPanelId).toBe("claude-code");
  expect(alone.publicPanels).toEqual([
    {
      id: "claude-code",
      name: "Claude Code",
      runtime: "claude-code",
      surfaces: ["conversations", "overview", "system", "files"],
    },
  ]);
  expect(JSON.stringify(alone.publicPanels)).not.toContain(root);
  const triple = readyRegistry({
    ...hermesConfiguration,
    COCKPIT_CODEX_HOME: `${missingRoot}/codex`,
    COCKPIT_CLAUDE_PROJECTS: projects,
    COCKPIT_DEFAULT_PANEL: "claude-code",
  });
  expect(triple.panels.map(({ id }) => id)).toEqual(["hermes", "codex", "claude-code"]);
  expect(triple.defaultPanelId).toBe("claude-code");
  for (const value of ["relative/root", "/", " /synthetic/root", root]) {
    expect(resolvePanelRegistry({ COCKPIT_CLAUDE_SESSION_ROOT: value })).toMatchObject({
      state: "invalid",
      key: "COCKPIT_CLAUDE_SESSION_ROOT",
      requirement:
        "Remove COCKPIT_CLAUDE_SESSION_ROOT and configure COCKPIT_CLAUDE_PROJECTS instead.",
    });
  }
});
