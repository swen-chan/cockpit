import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { workspaceDirectorySchema, workspaceFileSchema } from "@/contracts/source-result";
import {
  loadFilesPageData,
  loadWorkspaceDirectory,
  loadWorkspacePreview,
} from "@/server/services/files";

describe("workspace files service", () => {
  let root = "";

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "cockpit-files-service-"));
    mkdirSync(path.join(root, "docs"));
    writeFileSync(path.join(root, "notes.md"), "# Fixture\n");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it("loads a root directory and initial file from the server-defined workspace", async () => {
    const data = await loadFilesPageData({
      environment: { COCKPIT_WORKSPACE_ROOT: root },
      now: new Date("2026-09-08T00:00:00Z"),
    });

    expect(workspaceDirectorySchema.safeParse(data.directory).success).toBe(true);
    expect(workspaceFileSchema.safeParse(data.initialFile).success).toBe(true);
    expect(data.initialFile?.path).toBe("notes.md");
    expect(data.directoryFailure).toBeUndefined();
    expect(data.previewFailure).toBeUndefined();
  });

  it("returns a safe page failure when the workspace is unavailable", async () => {
    const data = await loadFilesPageData({
      environment: {},
      now: new Date("2026-09-08T00:00:00Z"),
    });

    expect(data.directory).toEqual({
      path: "",
      parentPath: null,
      items: [],
      observedAt: "2026-09-08T00:00:00.000Z",
      truncated: false,
    });
    expect(data.initialFile).toBeNull();
    expect(data.directoryFailure).toMatchObject({ code: "missing_source", sourceId: "workspace" });
    expect(data.previewFailure).toBeUndefined();
  });

  it("keeps the directory available when only the initial preview fails", async () => {
    chmodSync(path.join(root, "notes.md"), 0o000);

    const data = await loadFilesPageData({
      environment: { COCKPIT_WORKSPACE_ROOT: root },
      now: new Date("2026-09-08T00:00:00Z"),
    });

    expect(data.directory.items.map((entry) => entry.path)).toContain("notes.md");
    expect(data.initialFile?.path).toBe("notes.md");
    expect(data.directoryFailure).toBeUndefined();
    expect(data.previewFailure).toMatchObject({
      code: "source_unavailable",
      sourceId: "workspace",
    });
  });

  it("loads nested directories and previews without accepting a browser root", async () => {
    writeFileSync(path.join(root, "docs", "nested.txt"), "nested");
    const options = { environment: { COCKPIT_WORKSPACE_ROOT: root } };

    const directory = await loadWorkspaceDirectory("docs", options);
    const preview = await loadWorkspacePreview("docs/nested.txt", options);
    expect(directory.items.map((entry) => entry.path)).toEqual(["docs/nested.txt"]);
    expect(preview.content).toBe("nested");
  });

  it("uses an explicit panel workspace without resolving unrelated Hermes environment", async () => {
    const otherWorkspace = mkdtempSync(path.join(tmpdir(), "cockpit-files-other-"));
    try {
      writeFileSync(path.join(otherWorkspace, "other.txt"), "wrong root");
      const options = {
        environment: {
          COCKPIT_HERMES_HOME: "/definitely-not-present/hermes-home",
          COCKPIT_WORKSPACE_ROOT: otherWorkspace,
        },
        workspaceRoot: root,
      };

      const directory = await loadWorkspaceDirectory("", options);
      expect(directory.items.map((entry) => entry.path)).toContain("notes.md");
      expect(directory.items.map((entry) => entry.path)).not.toContain("other.txt");
      await expect(loadWorkspacePreview("notes.md", options)).resolves.toMatchObject({
        content: "# Fixture\n",
      });
    } finally {
      rmSync(otherWorkspace, { recursive: true, force: true });
    }
  });
});

describe("workspace files GET routes", () => {
  let root = "";

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "cockpit-files-route-"));
    writeFileSync(path.join(root, "route.txt"), "route fixture");
    vi.stubEnv("COCKPIT_WORKSPACE_ROOT", root);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it("returns strict no-store directory and preview responses", async () => {
    const directoryRoute = await import("@/app/api/files/route");
    const previewRoute = await import("@/app/api/files/preview/route");
    const directoryResponse = await directoryRoute.GET(
      new Request("http://127.0.0.1/api/files?path="),
    );
    const previewResponse = await previewRoute.GET(
      new Request("http://127.0.0.1/api/files/preview?path=route.txt"),
    );

    expect(directoryResponse.status).toBe(200);
    expect(directoryResponse.headers.get("cache-control")).toBe("private, no-store");
    expect(workspaceDirectorySchema.safeParse(await directoryResponse.json()).success).toBe(true);
    expect(previewResponse.status).toBe(200);
    expect(previewResponse.headers.get("cache-control")).toBe("private, no-store");
    expect(workspaceFileSchema.safeParse(await previewResponse.json()).success).toBe(true);
  });

  it("rejects traversal before it reaches workspace content", async () => {
    const directoryRoute = await import("@/app/api/files/route");
    const response = await directoryRoute.GET(
      new Request("http://127.0.0.1/api/files?path=..%2Foutside"),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_path", sourceId: "workspace" });
  });
});
