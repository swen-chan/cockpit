import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import {
  scopedFailureResponse,
  scopedSuccessResponse,
  statusForScopedFailure,
} from "@/server/http/scoped-route";
import { resolveScopedPanel } from "@/server/panels/routing";
import { SourceSecurityError } from "@/server/security/errors";

const dataSchema = z.object({ value: z.literal("safe") }).strict();
const codex = resolveScopedPanel("codex", {
  COCKPIT_CODEX_HOME: "/synthetic/not-present/codex",
});

describe("scoped route responses", () => {
  it("returns only a strict panel-matched envelope with private no-store caching", async () => {
    const response = scopedSuccessResponse(codex, { value: "safe" }, dataSchema);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      panelId: "codex",
      runtime: "codex",
      data: { value: "safe" },
    });
  });

  it("fails closed when outgoing data does not satisfy its strict schema", () => {
    expect(() =>
      scopedSuccessResponse(codex, { value: "safe", rawConfig: { token: "private" } }, dataSchema),
    ).toThrowError(expect.objectContaining({ code: "protocol_violation" }));
  });

  it("does not echo an unknown panel and includes only a previously resolved fixed panel", async () => {
    const unknown = scopedFailureResponse(new SourceSecurityError("invalid_panel"), {
      sourceId: "panel",
      now: new Date("2026-09-16T08:00:00.000Z"),
    });
    expect(unknown.status).toBe(404);
    await expect(unknown.json()).resolves.toEqual({
      sourceId: "panel",
      code: "invalid_panel",
      message: "The requested Agent panel is unavailable.",
      observedAt: "2026-09-16T08:00:00.000Z",
    });

    const unsupported = scopedFailureResponse(new SourceSecurityError("unsupported_capability"), {
      sourceId: "jobs",
      panel: codex,
      now: new Date("2026-09-16T08:00:00.000Z"),
    });
    expect(unsupported.status).toBe(404);
    await expect(unsupported.json()).resolves.toMatchObject({
      panelId: "codex",
      sourceId: "jobs",
      code: "unsupported_capability",
    });
  });

  it("maps safe codes without turning source absence into a universal 404", async () => {
    expect(statusForScopedFailure("panel_required")).toBe(400);
    expect(statusForScopedFailure("invalid_path")).toBe(400);
    expect(statusForScopedFailure("invalid_panel")).toBe(404);
    expect(statusForScopedFailure("unsupported_capability")).toBe(404);
    expect(statusForScopedFailure("missing_source")).toBe(503);
    expect(statusForScopedFailure("missing_source", 404)).toBe(404);
    expect(statusForScopedFailure("protocol_violation")).toBe(503);

    const logger = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const unavailable = scopedFailureResponse(new SourceSecurityError("missing_source"), {
      sourceId: "task-store",
      panel: codex,
      now: new Date("2026-09-16T08:00:00.000Z"),
    });
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("cache-control")).toBe("private, no-store");
    expect(logger).toHaveBeenCalledWith("[cockpit] source request failed", {
      sourceId: "task-store",
      code: "missing_source",
      panelId: "codex",
    });

    const missingDetail = scopedFailureResponse(new SourceSecurityError("missing_source"), {
      sourceId: "task-store",
      panel: codex,
      missingSourceStatus: 404,
      now: new Date("2026-09-16T08:00:00.000Z"),
    });
    expect(missingDetail.status).toBe(404);
  });

  it("falls back to a strict fixed diagnostic if a developer supplies an unsafe source ID", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = scopedFailureResponse(new SourceSecurityError("source_unavailable"), {
      sourceId: "/private/path",
      panel: codex,
      now: new Date("2026-09-16T08:00:00.000Z"),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      sourceId: "request",
      code: "source_unavailable",
      message: "The local source could not be read.",
      observedAt: "2026-09-16T08:00:00.000Z",
    });
  });
});
