import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";

import { isCurrentPanelLocation, parseScopedPayload, scopedApiPath } from "@/lib/scoped-client";

const dataSchema = z.object({ value: z.string() }).strict();

describe("scoped client boundary", () => {
  afterEach(() => window.history.replaceState({}, "", "/"));

  it("accepts only a strict success envelope for the expected panel", () => {
    const payload = {
      panelId: "hermes",
      runtime: "hermes",
      data: { value: "safe" },
    };
    expect(parseScopedPayload(payload, "hermes", dataSchema)).toEqual({ value: "safe" });
    expect(parseScopedPayload(payload, "codex", dataSchema)).toBeNull();
    expect(parseScopedPayload({ ...payload, private: true }, "hermes", dataSchema)).toBeNull();
  });

  it("builds fixed scoped API paths and checks the committed panel location", () => {
    expect(scopedApiPath("codex", "system/context?id=fixed")).toBe(
      "/api/agents/codex/system/context?id=fixed",
    );
    window.history.replaceState({}, "", "/agents/codex/system");
    expect(isCurrentPanelLocation("codex")).toBe(true);
    expect(isCurrentPanelLocation("hermes")).toBe(false);
  });
});
