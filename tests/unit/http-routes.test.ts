import { describe, expect, it } from "vitest";

import * as conversationDetailRoute from "@/app/api/conversations/[id]/route";
import * as conversationsRoute from "@/app/api/conversations/route";
import * as filePreviewRoute from "@/app/api/files/preview/route";
import * as filesRoute from "@/app/api/files/route";
import * as jobsRoute from "@/app/api/jobs/route";
import * as overviewRoute from "@/app/api/overview/route";
import * as systemContextRoute from "@/app/api/system/context/route";
import * as systemRoute from "@/app/api/system/route";

describe("GET-only route boundary", () => {
  it.each([
    ["overview", () => overviewRoute.GET(new Request("http://127.0.0.1:3000/api/overview?source=/private"))],
    ["system", () => systemRoute.GET(new Request("http://127.0.0.1:3000/api/system?source=/private"))],
    ["skill-manifest", () => systemContextRoute.GET(new Request("http://127.0.0.1:3000/api/system/context?id=../SKILL.md"))],
    ["conversation-store", () => conversationsRoute.GET(new Request("http://127.0.0.1:3000/api/conversations?limit=26"))],
    ["conversation-store", () => conversationDetailRoute.GET(
      new Request("http://127.0.0.1:3000/api/conversations/raw-id"),
      { params: Promise.resolve({ id: "raw-id" }) },
    )],
    ["workspace", () => filesRoute.GET(new Request("http://127.0.0.1:3000/api/files?path=..%2Foutside"))],
    ["workspace", () => filePreviewRoute.GET(new Request("http://127.0.0.1:3000/api/files/preview"))],
    ["jobs", () => jobsRoute.GET(new Request("http://127.0.0.1:3000/api/jobs?source=/private"))],
  ])("rejects invalid %s input before source resolution", async (sourceId, invoke) => {
    const response = await invoke();
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ sourceId, code: "invalid_path" });
  });
});
