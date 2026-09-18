import { describe, expect, it } from "vitest";

import {
  requireLegacyApiMode,
  requireScopedPanelSurface,
  resolveScopedPanel,
} from "@/server/panels/routing";

describe("Agent panel request routing", () => {
  it("keeps the legacy API mode structural and source-free", () => {
    expect(requireLegacyApiMode({}).configuration).toEqual({ mode: "legacy" });
  });

  it("rejects every unscoped API once scoped mode is configured", () => {
    expect(() =>
      requireLegacyApiMode({
        COCKPIT_CODEX_HOME: "/synthetic/not-present/codex",
      }),
    ).toThrowError(expect.objectContaining({ code: "panel_required" }));
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
