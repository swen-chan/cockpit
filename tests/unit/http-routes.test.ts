import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as conversationDetailRoute from "@/app/api/agents/[panelId]/conversations/[id]/route";
import * as conversationsRoute from "@/app/api/agents/[panelId]/conversations/route";
import * as filePreviewRoute from "@/app/api/agents/[panelId]/files/preview/route";
import * as filesRoute from "@/app/api/agents/[panelId]/files/route";
import * as jobsRoute from "@/app/api/agents/[panelId]/jobs/route";
import * as overviewRoute from "@/app/api/agents/[panelId]/overview/route";
import * as systemContextRoute from "@/app/api/agents/[panelId]/system/context/route";
import * as systemRoute from "@/app/api/agents/[panelId]/system/route";

describe("GET-only route boundary", () => {
  beforeEach(() => {
    for (const key of [
      "COCKPIT_CODEX_HOME",
      "COCKPIT_CODEX_WORKSPACE_ROOT",
      "COCKPIT_CODEX_CUSTOM_GUIDANCE",
      "COCKPIT_DEFAULT_PANEL",
      "COCKPIT_SOURCE_MANIFEST",
    ])
      vi.stubEnv(key, "");
    vi.stubEnv("COCKPIT_SOURCE_PRESET", "hermes-v2026.9.11");
    vi.stubEnv("COCKPIT_WORKSPACE_ROOT", "/synthetic/workspace");
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    [
      "overview",
      () =>
        overviewRoute.GET(
          new Request("http://127.0.0.1:3000/api/agents/hermes/overview?source=/private"),
          { params: Promise.resolve({ panelId: "hermes" }) },
        ),
    ],
    [
      "system",
      () =>
        systemRoute.GET(
          new Request("http://127.0.0.1:3000/api/agents/hermes/system?source=/private"),
          { params: Promise.resolve({ panelId: "hermes" }) },
        ),
    ],
    [
      "skill-manifest",
      () =>
        systemContextRoute.GET(
          new Request("http://127.0.0.1:3000/api/agents/hermes/system/context?id=../SKILL.md"),
          { params: Promise.resolve({ panelId: "hermes" }) },
        ),
    ],
    [
      "conversation-store",
      () =>
        conversationsRoute.GET(
          new Request("http://127.0.0.1:3000/api/agents/hermes/conversations?limit=26"),
          { params: Promise.resolve({ panelId: "hermes" }) },
        ),
    ],
    [
      "conversation-store",
      () =>
        conversationDetailRoute.GET(
          new Request("http://127.0.0.1:3000/api/agents/hermes/conversations/raw-id"),
          {
            params: Promise.resolve({ panelId: "hermes", id: "raw-id" }),
          },
        ),
    ],
    [
      "workspace",
      () =>
        filesRoute.GET(
          new Request("http://127.0.0.1:3000/api/agents/hermes/files?path=..%2Foutside"),
          { params: Promise.resolve({ panelId: "hermes" }) },
        ),
    ],
    [
      "workspace",
      () =>
        filePreviewRoute.GET(new Request("http://127.0.0.1:3000/api/agents/hermes/files/preview"), {
          params: Promise.resolve({ panelId: "hermes" }),
        }),
    ],
    [
      "jobs",
      () =>
        jobsRoute.GET(new Request("http://127.0.0.1:3000/api/agents/hermes/jobs?source=/private"), {
          params: Promise.resolve({ panelId: "hermes" }),
        }),
    ],
  ])("rejects invalid %s input before source resolution", async (sourceId, invoke) => {
    const response = await invoke();
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ sourceId, code: "invalid_path" });
  });
});
