import { describe, expect, it } from "vitest";

import type { PublicAgentPanel } from "@/contracts/agents";
import {
  panelSurfaceHref,
  panelSurfaceLabel,
  surfaceFromPathname,
  switchTarget,
} from "@/lib/panel-navigation";

const hermes: PublicAgentPanel = {
  id: "hermes",
  name: "Hermes",
  runtime: "hermes",
  surfaces: ["overview", "system", "conversations", "files", "jobs"],
};

const codex: PublicAgentPanel = {
  id: "codex",
  name: "Codex",
  runtime: "codex",
  surfaces: ["overview", "system", "conversations"],
};

describe("panel navigation", () => {
  it("maps fixed panel surfaces without accepting a browser-controlled path", () => {
    expect(panelSurfaceHref("hermes", "overview")).toBe("/agents/hermes");
    expect(panelSurfaceHref("codex", "conversations")).toBe("/agents/codex/conversations");
    expect(surfaceFromPathname("/agents/hermes/files")).toBe("files");
    expect(surfaceFromPathname("/agents/codex/anything-else")).toBe("overview");
  });

  it("uses Tasks only as the Codex display label", () => {
    expect(panelSurfaceLabel(hermes, "conversations")).toBe("Conversations");
    expect(panelSurfaceLabel(codex, "conversations")).toBe("Tasks");
  });

  it("preserves supported surfaces and falls back deterministically", () => {
    expect(switchTarget(codex, "system")).toEqual({
      href: "/agents/codex/system?from=system",
      fallback: false,
    });
    expect(switchTarget(codex, "jobs")).toEqual({
      href: "/agents/codex?from=jobs",
      fallback: true,
    });
  });
});
