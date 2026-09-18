import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OverviewSnapshot } from "@/contracts/cockpit";
import { overviewSnapshotSchema } from "@/contracts/source-result";

const mocks = vi.hoisted(() => ({
  loadOverviewSnapshot: vi.fn(),
}));

vi.mock("@/server/services/overview", () => ({
  loadOverviewSnapshot: mocks.loadOverviewSnapshot,
}));

import { GET } from "@/app/api/overview/route";

const partialSnapshot: OverviewSnapshot = {
  observedAt: "2026-09-09T03:30:00.000Z",
  profile: {
    state: "ready",
    observedAt: "2026-09-09T03:30:00.000Z",
    profile: "default",
    homeLabel: "/Users/fixture/.hermes",
    configState: "ready",
    model: "fixture-model",
    provider: "fixture-provider",
  },
  conversations: {
    state: "unavailable",
    observedAt: "2026-09-09T03:30:00.000Z",
    message: "The requested local source is unavailable.",
    items: [],
    hasMore: false,
  },
  system: {
    state: "ready",
    observedAt: "2026-09-09T03:30:00.000Z",
    items: [],
  },
  jobs: {
    state: "ready",
    observedAt: "2026-09-09T03:30:00.000Z",
    total: 0,
    enabled: 0,
    paused: 0,
    failedLastRun: 0,
    executionsState: "ready",
    nextEvent: null,
  },
  workspace: {
    state: "ready",
    observedAt: "2026-09-09T03:30:00.000Z",
    loadedCount: 0,
    truncated: false,
    items: [],
  },
};

describe("GET /api/overview", () => {
  beforeEach(() => {
    mocks.loadOverviewSnapshot.mockResolvedValue(partialSnapshot);
  });

  it("returns a valid partial snapshot with private no-store caching", async () => {
    const response = await GET(new Request("http://127.0.0.1:3000/api/overview"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(overviewSnapshotSchema.safeParse(body).success).toBe(true);
    expect(body.conversations.state).toBe("unavailable");
    expect(body.profile.state).toBe("ready");
  });

  it("rejects an invalid outgoing contract without forwarding unknown fields", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.loadOverviewSnapshot.mockResolvedValue({
      ...partialSnapshot,
      rawConfig: { token: "private" },
    });

    const response = await GET(new Request("http://127.0.0.1:3000/api/overview"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body).not.toHaveProperty("rawConfig");
    expect(body).toMatchObject({ sourceId: "overview", code: "source_unavailable" });
  });
});
