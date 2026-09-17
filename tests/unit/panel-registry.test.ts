import { describe, expect, it } from "vitest";

import {
  chooseInitialPanelId,
  requirePanelSurface,
  resolveLegacyHermesPanel,
  resolvePanel,
  resolvePanelRegistry,
} from "@/server/panels/registry";

const missingRoot = "/definitely-not-present/cockpit-fixture";

describe("fixed Agent panel registry", () => {
  it("preserves legacy single-Hermes policy without resolving incomplete sources", () => {
    const registry = resolvePanelRegistry({
      COCKPIT_WORKSPACE_ROOT: "relative-legacy-value",
      COCKPIT_SOURCE_PRESET: "legacy-one",
      COCKPIT_SOURCE_MANIFEST: "legacy-two",
    });

    expect(registry).toMatchObject({
      mode: "legacySingleHermes",
      defaultPanelId: "hermes",
      publicPanels: [
        {
          id: "hermes",
          name: "Hermes",
          runtime: "hermes",
          surfaces: ["overview", "system", "conversations", "files", "jobs"],
        },
      ],
    });
    expect(resolveLegacyHermesPanel(registry).configuration).toEqual({ mode: "legacy" });
  });

  it("constructs Codex-only panels from structural paths without touching the filesystem", () => {
    const withoutWorkspace = resolvePanelRegistry({
      COCKPIT_CODEX_HOME: `${missingRoot}/codex-home`,
    });
    expect(withoutWorkspace).toMatchObject({
      mode: "scopedCodexOnly",
      defaultPanelId: "codex",
      publicPanels: [
        {
          id: "codex",
          name: "Codex",
          runtime: "codex",
          surfaces: ["overview", "system", "conversations"],
        },
      ],
    });

    const withWorkspace = resolvePanelRegistry({
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
    const registry = resolvePanelRegistry({
      COCKPIT_WORKSPACE_ROOT: `${missingRoot}/hermes-workspace`,
      COCKPIT_SOURCE_PRESET: "future-hermes-layout",
      COCKPIT_HERMES_HOME: `${missingRoot}/hermes-home`,
      COCKPIT_CODEX_HOME: `${missingRoot}/codex-home`,
      COCKPIT_DEFAULT_PANEL: "codex",
    });

    expect(registry.mode).toBe("scopedDual");
    expect(registry.panels.map(({ id }) => id)).toEqual(["hermes", "codex"]);
    expect(registry.defaultPanelId).toBe("codex");
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.panels)).toBe(true);
    expect(Object.isFrozen(registry.publicPanels[0]?.surfaces)).toBe(true);
  });

  it("captures the documented Hermes home fallback only for an explicitly configured Hermes panel", () => {
    const ambientHermesHome = `${missingRoot}/ambient-hermes-home`;
    const cockpitHermesHome = `${missingRoot}/cockpit-hermes-home`;
    const base = {
      COCKPIT_WORKSPACE_ROOT: `${missingRoot}/hermes-workspace`,
      COCKPIT_SOURCE_PRESET: "future-hermes-layout",
      COCKPIT_CODEX_HOME: `${missingRoot}/codex-home`,
    };

    const fallback = resolvePanel(
      resolvePanelRegistry({
        ...base,
        HERMES_HOME: ambientHermesHome,
      }),
      "hermes",
    );
    expect(fallback.runtime).toBe("hermes");
    expect(fallback.runtime === "hermes" ? fallback.configuration : null).toMatchObject({
      mode: "scoped",
      explicitHome: ambientHermesHome,
    });

    const preferred = resolvePanel(
      resolvePanelRegistry({
        ...base,
        COCKPIT_HERMES_HOME: cockpitHermesHome,
        HERMES_HOME: ambientHermesHome,
      }),
      "hermes",
    );
    expect(preferred.runtime === "hermes" ? preferred.configuration : null).toMatchObject({
      mode: "scoped",
      explicitHome: cockpitHermesHome,
    });

    expect(
      resolvePanelRegistry({
        COCKPIT_CODEX_HOME: `${missingRoot}/codex-home`,
        HERMES_HOME: ambientHermesHome,
      }).mode,
    ).toBe("scopedCodexOnly");
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
    const registry = resolvePanelRegistry({
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
    [{ COCKPIT_CODEX_WORKSPACE_ROOT: `${missingRoot}/workspace` }],
    [{ COCKPIT_CODEX_CUSTOM_GUIDANCE: "SOUL.md" }],
    [{ COCKPIT_CODEX_HOME: "relative/codex" }],
    [{ COCKPIT_CODEX_HOME: "/" }],
    [{ COCKPIT_CODEX_HOME: `${missingRoot}/codex`, COCKPIT_CODEX_CUSTOM_GUIDANCE: "SOUL.md" }],
    [
      {
        COCKPIT_CODEX_HOME: `${missingRoot}/codex`,
        COCKPIT_CODEX_WORKSPACE_ROOT: "relative/workspace",
      },
    ],
    [
      {
        COCKPIT_CODEX_HOME: `${missingRoot}/codex`,
        COCKPIT_CODEX_WORKSPACE_ROOT: `${missingRoot}/workspace`,
        COCKPIT_CODEX_CUSTOM_GUIDANCE: "../SOUL.md",
      },
    ],
    [
      {
        COCKPIT_CODEX_HOME: `${missingRoot}/codex`,
        COCKPIT_CODEX_WORKSPACE_ROOT: `${missingRoot}/workspace`,
        COCKPIT_CODEX_CUSTOM_GUIDANCE: "/SOUL.md",
      },
    ],
    [
      {
        COCKPIT_CODEX_HOME: `${missingRoot}/codex`,
        COCKPIT_WORKSPACE_ROOT: `${missingRoot}/hermes`,
      },
    ],
    [
      {
        COCKPIT_CODEX_HOME: `${missingRoot}/codex`,
        COCKPIT_WORKSPACE_ROOT: `${missingRoot}/hermes`,
        COCKPIT_SOURCE_PRESET: "one",
        COCKPIT_SOURCE_MANIFEST: `${missingRoot}/two.json`,
      },
    ],
    [
      {
        COCKPIT_CODEX_HOME: `${missingRoot}/codex`,
        COCKPIT_WORKSPACE_ROOT: `${missingRoot}/hermes`,
        COCKPIT_SOURCE_MANIFEST: "/",
      },
    ],
    [{ COCKPIT_CODEX_HOME: `${missingRoot}/codex`, COCKPIT_DEFAULT_PANEL: "hermes" }],
    [{ COCKPIT_CODEX_HOME: `${missingRoot}/codex\nchild` }],
    [{ COCKPIT_CODEX_HOME: `${missingRoot}/codex\n` }],
    [{ COCKPIT_CODEX_HOME: `${missingRoot}/codex ` }],
    [{ COCKPIT_CODEX_HOME: " " }],
    [{ COCKPIT_CODEX_HOME: `${missingRoot}/codex`, COCKPIT_DEFAULT_PANEL: " codex " }],
  ])("rejects partial, conflicting, or unsafe scoped configuration %#", (environment) => {
    expect(() => resolvePanelRegistry(environment)).toThrowError(
      expect.objectContaining({ code: "source_malformed" }),
    );
  });

  it("resolves remembered/default panels without using availability as a fallback", () => {
    const registry = resolvePanelRegistry({
      COCKPIT_WORKSPACE_ROOT: `${missingRoot}/hermes`,
      COCKPIT_SOURCE_PRESET: "hermes-v2026.9.11",
      COCKPIT_CODEX_HOME: `${missingRoot}/codex`,
      COCKPIT_DEFAULT_PANEL: "codex",
    });

    expect(chooseInitialPanelId(registry, "hermes")).toBe("hermes");
    expect(chooseInitialPanelId(registry, "removed-panel")).toBe("codex");
    expect(chooseInitialPanelId(registry, null)).toBe("codex");
  });

  it("rejects unknown panels and unsupported capabilities without fallback", () => {
    const registry = resolvePanelRegistry({ COCKPIT_CODEX_HOME: `${missingRoot}/codex` });
    expect(() => resolvePanel(registry, "hermes")).toThrowError(
      expect.objectContaining({ code: "invalid_panel" }),
    );
    expect(() => resolvePanel(registry, "../../hermes")).toThrowError(
      expect.objectContaining({ code: "invalid_panel" }),
    );
    const codex = resolvePanel(registry, "codex");
    expect(() => requirePanelSurface(codex, "jobs")).toThrowError(
      expect.objectContaining({
        code: "unsupported_capability",
      }),
    );
    expect(() => resolveLegacyHermesPanel(registry)).toThrowError(
      expect.objectContaining({ code: "panel_required" }),
    );
  });
});
