// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import type { WorkspaceDirectory } from "@/contracts/cockpit";
import { codexOverviewSnapshotSchema } from "@/contracts/codex";
import type { CodexGuidanceSource } from "@/server/codex/guidance";
import type { CodexPanelDescriptor } from "@/server/panels/registry";
import { resolvePanel, resolvePanelRegistry } from "@/server/panels/registry";
import { SourceSecurityError } from "@/server/security/errors";
import { createCodexOverviewServiceForTest } from "@/server/services/codex-overview";
import type { CodexTaskListObservation } from "@/server/services/codex-tasks";

const observedAt = "2026-09-16T08:00:00.000Z";

function panel(withWorkspace = true): CodexPanelDescriptor {
  const resolved = resolvePanel(
    resolvePanelRegistry({
      COCKPIT_CODEX_HOME: "/synthetic/codex",
      ...(withWorkspace ? { COCKPIT_CODEX_WORKSPACE_ROOT: "/synthetic/workspace" } : {}),
    }),
    "codex",
  );
  if (resolved.runtime !== "codex") throw new Error("synthetic panel mismatch");
  return resolved;
}

function taskObservation(
  tasks: CodexTaskListObservation["tasks"] = {
    state: "ready",
    page: {
      items: [
        {
          id: "task-Abc_123",
          title: "Synthetic task",
          preview: "Safe preview",
          source: "CLI",
          lastActivity: observedAt,
          status: "idle",
          projectLabel: "cockpit",
        },
      ],
      nextCursor: "cursor-Abc_456",
      observedAt,
      indexScope: "Codex state database",
      inventoryNote: "State-database index; some local tasks may be absent.",
    },
  },
): CodexTaskListObservation {
  return {
    runtime: { state: "ready", version: "0.145.0" },
    tasks,
  };
}

function guidance(): CodexGuidanceSource[] {
  return [
    {
      key: "global-guidance",
      label: "Global guidance",
      origin: "Codex home",
      state: "ready",
      content: "private content must not enter Overview",
      truncated: false,
    },
    {
      key: "workspace-guidance",
      label: "Workspace guidance",
      state: "missing",
      message: "No current guidance was observed.",
    },
  ];
}

function workspace(): WorkspaceDirectory {
  return {
    path: "",
    parentPath: null,
    observedAt,
    truncated: true,
    items: [
      {
        id: "older.md",
        name: "older.md",
        path: "older.md",
        entryType: "file",
        kind: "Markdown",
        size: "1 B",
        sizeBytes: 1,
        modifiedAt: "2026-09-16T06:00:00.000Z",
        previewState: "available",
      },
      {
        id: "docs",
        name: "docs",
        path: "docs",
        entryType: "directory",
        kind: "Directory",
        size: "—",
        sizeBytes: null,
        modifiedAt: "2026-09-16T09:00:00.000Z",
        previewState: "unavailable",
      },
      {
        id: "newer.ts",
        name: "newer.ts",
        path: "newer.ts",
        entryType: "file",
        kind: "Text",
        size: "2 B",
        sizeBytes: 2,
        modifiedAt: "2026-09-16T07:00:00.000Z",
        previewState: "available",
      },
    ],
  };
}

describe("Codex Overview service", () => {
  it("runs one staged list concurrently with direct guidance and workspace readers", async () => {
    let releaseTasks: (() => void) | undefined;
    const taskGate = new Promise<void>((resolve) => {
      releaseTasks = resolve;
    });
    const tasks = vi.fn(async () => {
      await taskGate;
      return taskObservation();
    });
    const guidanceReader = vi.fn(async () => guidance());
    const workspaceReader = vi.fn(async () => workspace());
    const load = createCodexOverviewServiceForTest({
      tasks,
      guidance: guidanceReader,
      workspace: workspaceReader,
    });

    const pending = load(panel(), { now: new Date(observedAt) });
    await vi.waitFor(() => {
      expect(tasks).toHaveBeenCalledOnce();
      expect(guidanceReader).toHaveBeenCalledOnce();
      expect(workspaceReader).toHaveBeenCalledOnce();
    });
    releaseTasks?.();
    const snapshot = await pending;

    expect(snapshot.runtime).toMatchObject({ state: "ready", version: "0.145.0" });
    expect(snapshot.tasks).toMatchObject({ state: "ready", hasMore: true });
    expect(snapshot.guidance).toEqual({
      state: "ready",
      observedAt,
      items: [
        { label: "Global guidance", state: "ready" },
        { label: "Workspace guidance", state: "missing" },
      ],
    });
    expect(snapshot.workspace).toMatchObject({
      state: "ready",
      loadedCount: 3,
      truncated: true,
      items: [{ name: "newer.ts" }, { name: "older.md" }],
    });
    expect(codexOverviewSnapshotSchema.safeParse(snapshot).success).toBe(true);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("private content");
    expect(serialized).not.toContain("jobs");
  });

  it("keeps verified runtime when only the list stage fails", async () => {
    const load = createCodexOverviewServiceForTest({
      tasks: vi.fn(async () => taskObservation({ state: "failed", code: "source_busy" })),
      guidance: vi.fn(async () => guidance()),
      workspace: vi.fn(async () => workspace()),
    });

    const snapshot = await load(panel(), { now: new Date(observedAt) });

    expect(snapshot.runtime.state).toBe("ready");
    expect(snapshot.tasks).toEqual({
      state: "error",
      observedAt,
      message: "The local source is temporarily busy.",
    });
    expect(snapshot.guidance.state).toBe("ready");
    expect(snapshot.workspace.state).toBe("ready");
  });

  it("fails runtime and tasks together when no probe result exists", async () => {
    const load = createCodexOverviewServiceForTest({
      tasks: vi.fn(async () => ({
        runtime: { state: "failed" as const, code: "unsupported_runtime_version" as const },
        tasks: { state: "failed" as const, code: "unsupported_runtime_version" as const },
      })),
      guidance: vi.fn(async () => guidance()),
      workspace: vi.fn(async () => workspace()),
    });

    const snapshot = await load(panel(), { now: new Date(observedAt) });

    expect(snapshot.runtime).toEqual(snapshot.tasks);
    expect(snapshot.runtime).toMatchObject({
      state: "error",
      message: "The selected Agent runtime version is not supported.",
    });
  });

  it("localizes whole-reader failures and leaves sibling sections available", async () => {
    const load = createCodexOverviewServiceForTest({
      tasks: vi.fn(async () => taskObservation()),
      guidance: vi.fn(async () => {
        throw new Error("private guidance failure");
      }),
      workspace: vi.fn(async () => {
        throw new SourceSecurityError("missing_source");
      }),
    });

    const snapshot = await load(panel(), { now: new Date(observedAt) });

    expect(snapshot.runtime.state).toBe("ready");
    expect(snapshot.tasks.state).toBe("ready");
    expect(snapshot.guidance.state).toBe("error");
    expect(snapshot.workspace.state).toBe("unavailable");
    expect(JSON.stringify(snapshot)).not.toContain("private guidance failure");
  });

  it("does not call a workspace reader when Files is not configured", async () => {
    const workspaceReader = vi.fn(async () => workspace());
    const load = createCodexOverviewServiceForTest({
      tasks: vi.fn(async () => taskObservation()),
      guidance: vi.fn(async () => guidance().slice(0, 1)),
      workspace: workspaceReader,
    });

    const snapshot = await load(panel(false), { now: new Date(observedAt) });

    expect(workspaceReader).not.toHaveBeenCalled();
    expect(snapshot.workspace).toEqual({
      state: "unsupported",
      observedAt,
      message: "Files not configured",
    });
  });
});
