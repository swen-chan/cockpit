// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import type { CodexAppServerReader } from "@/server/codex/app-server-reader";
import { createCodexTasksServiceForTest } from "@/server/services/codex-tasks";
import { createPanelTokenCodec, type PanelTokenCodec } from "@/server/panels/opaque-token";
import type { CodexPanelDescriptor } from "@/server/panels/registry";
import { resolvePanel, resolvePanelRegistry } from "@/server/panels/registry";

function panel(): CodexPanelDescriptor {
  const resolved = resolvePanel(
    resolvePanelRegistry({ COCKPIT_CODEX_HOME: "/synthetic/codex" }),
    "codex",
  );
  if (resolved.runtime !== "codex") throw new Error("synthetic panel mismatch");
  return resolved;
}

function rawThread(id = "raw-task") {
  return {
    id,
    sessionId: id,
    preview: "Synthetic question",
    ephemeral: false,
    modelProvider: "synthetic",
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_001,
    status: { type: "idle" },
    path: "/synthetic/codex/sessions/task.jsonl",
    cwd: "/synthetic/workspace/project-one",
    cliVersion: "0.145.0",
    source: "cli",
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: "Synthetic task",
    parentThreadId: null,
    turns: [
      {
        id: "raw-turn",
        status: "completed",
        error: null,
        items: [
          {
            type: "userMessage",
            id: "raw-user",
            content: [{ type: "text", text: "Synthetic question", text_elements: [] }],
          },
          {
            type: "agentMessage",
            id: "raw-answer",
            text: "Synthetic final answer",
            phase: "final_answer",
          },
        ],
      },
    ],
  };
}

function tokenSpies(): PanelTokenCodec {
  return {
    decodeCursor: vi.fn(() => "raw-cursor"),
    encodeCursor: vi.fn(() => "cursor-next-public"),
    decodeTask: vi.fn(() => "raw-task"),
    encodeTask: vi.fn(() => "task-list-public"),
  };
}

function readerSpies(): CodexAppServerReader {
  const listResult = { data: [{ ...rawThread(), turns: [] }], nextCursor: "raw-next" };
  return {
    list: vi.fn(async () => listResult),
    observeList: vi.fn(async () => ({
      runtime: { state: "ready" as const, version: "0.145.0" as const },
      tasks: { state: "ready" as const, result: listResult },
    })),
    probe: vi.fn(async () => ({ version: "0.145.0" as const })),
    read: vi.fn(async (_panel, taskId) => ({ thread: rawThread(taskId) })),
  };
}

describe("Codex Tasks service", () => {
  it("decodes one cursor, performs one list read, and never eagerly reads a detail", async () => {
    const selectedPanel = panel();
    const reader = readerSpies();
    const tokens = tokenSpies();
    const abort = new AbortController();
    const service = createCodexTasksServiceForTest({
      reader,
      tokens,
      now: () => new Date("2026-09-16T05:00:00.000Z"),
      homedir: () => "/synthetic/operator",
    });

    const page = await service.list(selectedPanel, {
      cursor: "cursor-request-public",
      signal: abort.signal,
    });

    expect(tokens.decodeCursor).toHaveBeenCalledOnce();
    expect(tokens.decodeCursor).toHaveBeenCalledWith(
      expect.objectContaining({ panelId: "codex" }),
      "cursor-request-public",
    );
    expect(reader.list).toHaveBeenCalledOnce();
    expect(reader.list).toHaveBeenCalledWith(selectedPanel, {
      cursor: "raw-cursor",
      signal: abort.signal,
    });
    expect(reader.read).not.toHaveBeenCalled();
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe("cursor-next-public");
  });

  it("projects a staged list observation without starting a second reader operation", async () => {
    const selectedPanel = panel();
    const reader = readerSpies();
    const tokens = tokenSpies();
    const service = createCodexTasksServiceForTest({
      reader,
      tokens,
      now: () => new Date("2026-09-16T05:00:00.000Z"),
      homedir: () => "/synthetic/operator",
    });

    const observation = await service.observeList(selectedPanel);

    expect(reader.observeList).toHaveBeenCalledOnce();
    expect(reader.list).not.toHaveBeenCalled();
    expect(reader.read).not.toHaveBeenCalled();
    expect(observation.runtime).toEqual({ state: "ready", version: "0.145.0" });
    expect(observation.tasks).toMatchObject({
      state: "ready",
      page: { items: [expect.objectContaining({ projectLabel: "project-one" })] },
    });
  });

  it("keeps verified runtime when list projection rejects an invalid wire result", async () => {
    const selectedPanel = panel();
    const reader = readerSpies();
    vi.mocked(reader.observeList).mockResolvedValue({
      runtime: { state: "ready", version: "0.145.0" },
      tasks: { state: "ready", result: { data: "not-an-array", nextCursor: null } },
    });
    const service = createCodexTasksServiceForTest({ reader, tokens: tokenSpies() });

    await expect(service.observeList(selectedPanel)).resolves.toEqual({
      runtime: { state: "ready", version: "0.145.0" },
      tasks: { state: "failed", code: "protocol_violation" },
    });
  });

  it("decodes one task token, passes only the raw ID to read, and reuses the requested public ID", async () => {
    const selectedPanel = panel();
    const reader = readerSpies();
    const tokens = tokenSpies();
    const abort = new AbortController();
    const service = createCodexTasksServiceForTest({
      reader,
      tokens,
      now: () => new Date("2026-09-16T05:00:00.000Z"),
      homedir: () => "/synthetic/operator",
    });

    const detail = await service.detail(selectedPanel, "task-request-public", {
      signal: abort.signal,
    });

    expect(tokens.decodeTask).toHaveBeenCalledOnce();
    expect(tokens.decodeTask).toHaveBeenCalledWith(
      expect.objectContaining({ panelId: "codex" }),
      "task-request-public",
    );
    expect(reader.read).toHaveBeenCalledOnce();
    expect(reader.read).toHaveBeenCalledWith(selectedPanel, "raw-task", { signal: abort.signal });
    expect(tokens.encodeTask).not.toHaveBeenCalled();
    expect(detail.summary.id).toBe("task-request-public");
  });

  it("round-trips a listed UUID through the real codec before the detail read", async () => {
    const selectedPanel = panel();
    const rawTaskId = "019d072f-4cbb-7000-8000-000000000001";
    const reader: CodexAppServerReader = {
      list: vi.fn(async () => ({
        data: [{ ...rawThread(rawTaskId), turns: [] }],
        nextCursor: null,
      })),
      observeList: vi.fn(async () => ({
        runtime: { state: "ready" as const, version: "0.145.0" as const },
        tasks: {
          state: "ready" as const,
          result: { data: [{ ...rawThread(rawTaskId), turns: [] }], nextCursor: null },
        },
      })),
      probe: vi.fn(async () => ({ version: "0.145.0" as const })),
      read: vi.fn(async (_panel, taskId) => ({ thread: rawThread(taskId) })),
    };
    const tokens = createPanelTokenCodec(new Uint8Array(32).fill(11));
    const service = createCodexTasksServiceForTest({
      reader,
      tokens,
      now: () => new Date("2026-09-16T05:00:00.000Z"),
      homedir: () => "/synthetic/operator",
    });

    const page = await service.list(selectedPanel);
    const publicTaskId = page.items[0]?.id;
    expect(publicTaskId).toMatch(/^task-[A-Za-z0-9_-]+$/u);
    if (!publicTaskId) throw new Error("synthetic task token missing");

    const detail = await service.detail(selectedPanel, publicTaskId);

    expect(reader.read).toHaveBeenCalledOnce();
    expect(reader.read).toHaveBeenCalledWith(selectedPanel, rawTaskId, {});
    expect(detail.summary.id).toBe(publicTaskId);
    expect(JSON.stringify(page)).not.toContain(rawTaskId);
    expect(JSON.stringify(detail)).not.toContain(rawTaskId);
  });

  it("rejects forged and cross-panel task tokens before any source read", async () => {
    const selectedPanel = panel();
    const reader = readerSpies();
    const tokens = createPanelTokenCodec(new Uint8Array(32).fill(9));
    const hermesToken = tokens.encodeTask(
      {
        panelId: "hermes",
        runtime: "hermes",
        adapterVersion: "hermes-v1",
      },
      "raw-task",
    );
    const service = createCodexTasksServiceForTest({ reader, tokens });

    await expect(service.detail(selectedPanel, hermesToken)).rejects.toMatchObject({
      code: "invalid_path",
    });
    await expect(service.detail(selectedPanel, "task-forged")).rejects.toMatchObject({
      code: "invalid_path",
    });
    expect(reader.read).not.toHaveBeenCalled();
    expect(reader.list).not.toHaveBeenCalled();
  });

  it("rejects a forged cursor before the list reader is invoked", async () => {
    const selectedPanel = panel();
    const reader = readerSpies();
    const tokens = createPanelTokenCodec(new Uint8Array(32).fill(10));
    const service = createCodexTasksServiceForTest({ reader, tokens });

    await expect(service.list(selectedPanel, { cursor: "cursor-forged" })).rejects.toMatchObject({
      code: "invalid_path",
    });
    expect(reader.list).not.toHaveBeenCalled();
    expect(reader.read).not.toHaveBeenCalled();
  });
});
