import { afterEach, describe, expect, it, vi } from "vitest";

const readers = vi.hoisted(() => ({
  conversationPage: vi.fn(),
  conversationTranscript: vi.fn(),
  files: vi.fn(),
  jobs: vi.fn(),
  overview: vi.fn(),
  preview: vi.fn(),
  skill: vi.fn(),
  system: vi.fn(),
}));

vi.mock("@/server/services/conversations", () => ({
  loadConversationPage: readers.conversationPage,
  loadConversationTranscript: readers.conversationTranscript,
}));
vi.mock("@/server/services/files", () => ({
  loadWorkspaceDirectory: readers.files,
  loadWorkspacePreview: readers.preview,
}));
vi.mock("@/server/services/jobs", () => ({ loadJobsSnapshot: readers.jobs }));
vi.mock("@/server/services/overview", () => ({ loadOverviewSnapshot: readers.overview }));
vi.mock("@/server/services/system", () => ({
  loadSkillPreview: readers.skill,
  loadSystemPageData: readers.system,
}));

import * as conversationDetailRoute from "@/app/api/conversations/[id]/route";
import * as conversationsRoute from "@/app/api/conversations/route";
import * as filePreviewRoute from "@/app/api/files/preview/route";
import * as filesRoute from "@/app/api/files/route";
import * as jobsRoute from "@/app/api/jobs/route";
import * as overviewRoute from "@/app/api/overview/route";
import * as systemContextRoute from "@/app/api/system/context/route";
import * as systemRoute from "@/app/api/system/route";

function configureScopedMode(): void {
  vi.stubEnv("COCKPIT_CODEX_HOME", "/synthetic/not-present/codex");
  vi.stubEnv("COCKPIT_CODEX_WORKSPACE_ROOT", "");
  vi.stubEnv("COCKPIT_CODEX_CUSTOM_GUIDANCE", "");
  vi.stubEnv("COCKPIT_DEFAULT_PANEL", "");
  vi.stubEnv("COCKPIT_WORKSPACE_ROOT", "");
  vi.stubEnv("COCKPIT_SOURCE_PRESET", "");
  vi.stubEnv("COCKPIT_SOURCE_MANIFEST", "");
  vi.stubEnv("COCKPIT_HERMES_HOME", "");
}

describe("unscoped API mode guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns panel_required before query, path, ID, or source handling in scoped mode", async () => {
    configureScopedMode();
    const base = "http://127.0.0.1:3000";
    const requests = [
      ["overview", overviewRoute.GET(new Request(`${base}/api/overview?source=/private`))],
      ["system", systemRoute.GET(new Request(`${base}/api/system?source=/private`))],
      [
        "skill-manifest",
        systemContextRoute.GET(new Request(`${base}/api/system/context?id=../SKILL.md`)),
      ],
      [
        "conversation-store",
        conversationsRoute.GET(new Request(`${base}/api/conversations?limit=999`)),
      ],
      [
        "conversation-store",
        conversationDetailRoute.GET(new Request(`${base}/api/conversations/raw-id?unexpected=1`), {
          params: Promise.resolve({ id: "raw-id" }),
        }),
      ],
      ["workspace", filesRoute.GET(new Request(`${base}/api/files?path=..%2Fprivate`))],
      ["workspace", filePreviewRoute.GET(new Request(`${base}/api/files/preview`))],
      ["jobs", jobsRoute.GET(new Request(`${base}/api/jobs?source=/private`))],
    ] as const;

    for (const [sourceId, pendingResponse] of requests) {
      const response = await pendingResponse;
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      await expect(response.json()).resolves.toMatchObject({ sourceId, code: "panel_required" });
    }
    for (const reader of Object.values(readers)) expect(reader).not.toHaveBeenCalled();
  });
});
