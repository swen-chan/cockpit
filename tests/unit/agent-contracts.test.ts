import { describe, expect, it } from "vitest";

import {
  publicAgentPanelSchema,
  scopedFailureSchema,
  scopedSuccessSchema,
} from "@/contracts/agents";
import { codexTaskPageSchema } from "@/contracts/codex";

const page = {
  items: [],
  nextCursor: null,
  observedAt: "2026-09-16T00:00:00.000Z",
  indexScope: "Codex state database",
  inventoryNote: "State-database index; some local tasks may be absent.",
} as const;

describe("Agent browser contracts", () => {
  it("accepts only the fixed public panel identities and capability matrices", () => {
    expect(
      publicAgentPanelSchema.safeParse({
        id: "hermes",
        name: "Hermes",
        runtime: "hermes",
        surfaces: ["overview", "system", "conversations", "files", "jobs"],
      }).success,
    ).toBe(true);
    expect(
      publicAgentPanelSchema.safeParse({
        id: "codex",
        name: "Codex",
        runtime: "codex",
        surfaces: ["overview", "system", "conversations", "files"],
      }).success,
    ).toBe(true);

    for (const candidate of [
      {
        id: "hermes",
        name: "Hermes",
        runtime: "codex",
        surfaces: ["overview", "system", "conversations"],
      },
      {
        id: "codex",
        name: "Custom",
        runtime: "codex",
        surfaces: ["overview", "system", "conversations"],
      },
      { id: "codex", name: "Codex", runtime: "codex", surfaces: ["overview", "system", "jobs"] },
      {
        id: "codex",
        name: "Codex",
        runtime: "codex",
        surfaces: ["overview", "system", "conversations"],
        root: "/private",
      },
    ]) {
      expect(publicAgentPanelSchema.safeParse(candidate).success).toBe(false);
    }
  });

  it("requires strict panel-matched success envelopes", () => {
    const schema = scopedSuccessSchema(codexTaskPageSchema);
    expect(schema.safeParse({ panelId: "codex", runtime: "codex", data: page }).success).toBe(true);
    expect(schema.safeParse({ panelId: "hermes", runtime: "codex", data: page }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({ panelId: "codex", runtime: "codex", data: page, rawConfig: {} }).success,
    ).toBe(false);
  });

  it("keeps scoped failures bounded and rejects untrusted route echoes", () => {
    const failure = {
      panelId: "codex",
      sourceId: "task-store",
      code: "protocol_violation",
      message: "The local Agent reader returned an invalid response.",
      observedAt: "2026-09-16T00:00:00.000Z",
    };
    expect(scopedFailureSchema.safeParse(failure).success).toBe(true);
    expect(scopedFailureSchema.safeParse({ ...failure, panelId: "../../private" }).success).toBe(
      false,
    );
    expect(
      scopedFailureSchema.safeParse({ ...failure, requestedPanel: "../../private" }).success,
    ).toBe(false);
    expect(scopedFailureSchema.safeParse({ ...failure, sourceId: "/private/path" }).success).toBe(
      false,
    );
    expect(
      scopedFailureSchema.safeParse({ ...failure, message: "Failed at /Users/private/.codex" })
        .success,
    ).toBe(false);
    expect(
      scopedFailureSchema.safeParse({ ...failure, observedAt: "/Users/private/.codex" }).success,
    ).toBe(false);
  });
});
