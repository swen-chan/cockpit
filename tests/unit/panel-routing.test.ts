import { describe, expect, it } from "vitest";

import { requireScopedPanelSurface, resolveScopedPanel } from "@/server/panels/routing";

describe("Agent panel request routing", () => {
  it("rejects source reads without a complete Agent configuration", () => {
    expect(() => resolveScopedPanel("hermes", {})).toThrowError(
      expect.objectContaining({ code: "missing_source" }),
    );
    expect(() =>
      resolveScopedPanel("hermes", { COCKPIT_WORKSPACE_ROOT: "/synthetic/workspace" }),
    ).toThrowError(expect.objectContaining({ code: "source_malformed" }));
  });

  it("resolves Hermes without requiring a Codex panel", () => {
    expect(
      resolveScopedPanel("hermes", {
        COCKPIT_WORKSPACE_ROOT: "/synthetic/workspace",
        COCKPIT_SOURCE_PRESET: "hermes-v2026.9.11",
      }).id,
    ).toBe("hermes");
  });

  it("resolves only fixed panel IDs and checks capability separately", () => {
    const environment = { COCKPIT_CODEX_HOME: "/synthetic/not-present/codex" };
    expect(() => resolveScopedPanel("../../private", environment)).toThrowError(
      expect.objectContaining({ code: "invalid_panel" }),
    );
    const codex = resolveScopedPanel("codex", environment);
    expect(requireScopedPanelSurface(codex, "system")).toBe(codex);
    expect(() => requireScopedPanelSurface(codex, "jobs")).toThrowError(
      expect.objectContaining({ code: "unsupported_capability" }),
    );
  });
});
