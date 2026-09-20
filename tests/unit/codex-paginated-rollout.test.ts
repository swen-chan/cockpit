// @vitest-environment node
import { chmodSync, existsSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import fixture from "../fixtures/codex-paginated.json";
import { parsePaginatedRollout, readPaginatedRollout } from "@/server/codex/paginated-rollout";
import { createOwnedTemp, type OwnedTemp } from "@/server/codex/owned-temp.mjs";
import { projectCodexTaskDetail } from "@/server/codex/task-projection";
import { resolvePanel, resolvePanelRegistry } from "@/server/panels/registry";

const taskId = "11111111-1111-4111-8111-000000000001";
const lines = (records: unknown[] = fixture) =>
  records.map((record) => JSON.stringify(record)).join("\n") + "\n";
const event = (payload: Record<string, unknown>) => ({ type: "event_msg", payload });
const item = (turn: string, id: string, text: string) =>
  event({
    type: "item_completed",
    turn_id: turn,
    item: { type: "AgentMessage", id, phase: "final_answer", content: [{ type: "Text", text }] },
  });

describe("bounded paginated local history", () => {
  let owner: OwnedTemp | undefined;
  afterEach(() => {
    if (owner) expect(owner.cleanup()).toBe(true);
    owner = undefined;
  });

  it("replays completed display events once and preserves an unfinished turn", () => {
    const history = parsePaginatedRollout(lines(), taskId)!;
    expect(history.turns.map((turn) => turn.status)).toEqual(["completed", "inProgress"]);
    expect(history.turns[0]?.items).toHaveLength(6);
    expect(history.localHistoryOnly).toBe(true);
    const serialized = JSON.stringify(history);
    for (const sentinel of [
      "PRIVATE_CONFIG",
      "DUPLICATE_MIRROR",
      "RAW_REASONING",
      "ENCRYPTED",
      "DO_NOT_EXECUTE",
      "PRIVATE_ARGUMENT",
      "PRIVATE_OUTPUT",
      "DUPLICATE_FINAL",
      "never-follow",
    ])
      expect(serialized).not.toContain(sentinel);
    expect(serialized).toContain("Recorded summary only.");
  });

  it("feeds the existing safe transcript and folded Process projection", () => {
    const history = parsePaginatedRollout(lines(), taskId)!;
    const panel = resolvePanel(
      resolvePanelRegistry({ COCKPIT_CODEX_HOME: "/synthetic/codex" }),
      "codex",
    );
    if (panel.runtime !== "codex") throw new Error("fixture panel");
    const detail = projectCodexTaskDetail(
      {
        ...history,
        thread: {
          id: taskId,
          source: "vscode",
          ephemeral: false,
          cwd: "/synthetic/project",
          name: "Synthetic paginated task",
          preview: "Synthetic",
          status: { type: "notLoaded" },
          updatedAt: 1700000000,
          turns: history.turns,
        },
      },
      {
        panel,
        publicTaskId: "task-synthetic",
        expectedRawTaskId: taskId,
        operatorHome: "/synthetic/home",
      },
    );
    expect(detail.turns[0]?.messages.map((message) => message.content)).toEqual([
      "Inspect the synthetic project.",
      "The synthetic project is ready.",
    ]);
    expect(detail.turns[0]?.process?.rows.map((row) => row.type)).toEqual([
      "progress",
      "reasoning_summary",
      "command",
      "hidden",
    ]);
    expect(detail.turns[1]?.process).toBeNull();
    expect(detail.turns[1]?.messages.at(-1)?.role).toBe("status");
    expect(detail.historyNote).toContain("inherited history is not followed");
    expect(JSON.stringify(detail)).not.toContain("SENTINEL");
  });

  it("leaves legacy full-history reading to the pinned App Server", () => {
    expect(
      parsePaginatedRollout(
        lines([{ type: "session_meta", payload: { id: taskId, history_mode: "legacy" } }]),
        taskId,
      ),
    ).toBeNull();
  });

  it("rejects nonempty mirrors without display events instead of reporting an empty task", () => {
    expect(() => parsePaginatedRollout(lines([fixture[0], fixture[3]]), taskId)).toThrow();
  });

  it("enforces record limits even when all records would otherwise be ignored", () => {
    expect(() =>
      parsePaginatedRollout(
        lines([
          fixture[0],
          ...Array.from({ length: 100_001 }, () => ({ type: "token_usage_record", payload: {} })),
        ]),
        taskId,
      ),
    ).toThrow();
    expect(() =>
      parsePaginatedRollout(lines([fixture[0]]) + "\n".repeat(100_001), taskId),
    ).toThrow();
  });

  it("deduplicates identical completed events but rejects conflicting identities", () => {
    const original = parsePaginatedRollout(lines(), taskId);
    expect(parsePaginatedRollout(lines([...fixture, fixture[2]]), taskId)).toEqual(original);
    expect(() =>
      parsePaginatedRollout(
        lines([...fixture, item("turn-a", "answer-a", "Conflicting answer")]),
        taskId,
      ),
    ).toThrow();
  });

  it("groups interleaved records by explicit turn identity", () => {
    const history = parsePaginatedRollout(
      lines([
        fixture[0],
        event({ type: "task_started", turn_id: "a" }),
        event({ type: "task_started", turn_id: "b" }),
        item("a", "x", "First"),
        item("b", "y", "Second"),
        event({ type: "task_complete", turn_id: "b", error: { message: "private" } }),
        event({ type: "turn_aborted", turn_id: "a" }),
      ]),
      taskId,
    )!;
    expect(history.turns.map((turn) => turn.status)).toEqual(["interrupted", "failed"]);
    expect(JSON.stringify(history.turns[0])).toContain("First");
    expect(JSON.stringify(history.turns[0])).not.toContain("Second");
    expect(JSON.stringify(history)).not.toContain("private");
  });

  it.each([
    "",
    "{}\n",
    "{broken}\n",
    lines([{ type: "session_meta", payload: { id: "wrong", history_mode: "paginated" } }]),
    lines([{ type: "session_meta", payload: { id: taskId, history_mode: "future" } }]),
    lines([
      ...fixture,
      event({ type: "item_completed", thread_id: "other", turn_id: "turn-a", item: { id: "a" } }),
    ]),
    lines([...fixture, event({ type: "item_completed", item: { id: "a" } })]),
    lines([...fixture, event({ type: "thread_rolled_back" })]),
    lines([...fixture, fixture[0]]),
    lines() + "{partial",
  ])("fails closed on malformed, unbound, or unsupported history %#", (text) => {
    expect(() => parsePaginatedRollout(text, taskId)).toThrow();
  });

  it("marks unknown display activity and event omissions without carrying payloads", () => {
    const history = parsePaginatedRollout(
      lines([
        ...fixture,
        event({ type: "future_event", private: "SENTINEL" }),
        event({
          type: "item_completed",
          turn_id: "turn-a",
          item: { type: "FutureActivity", id: "future", private: "SENTINEL" },
        }),
      ]),
      taskId,
    )!;
    expect(history.unsupportedRecords).toBe(1);
    expect(history.turns[0]?.items.at(-1)).toEqual({ type: "unsupportedRecordedActivity" });
    expect(JSON.stringify(history)).not.toContain("SENTINEL");
  });

  it("reads only the operation-owned copy and leaves its bytes unchanged", async () => {
    owner = createOwnedTemp();
    const file = path.join(owner.directory, "selected.jsonl");
    const text = lines();
    writeFileSync(file, text, { mode: 0o600 });
    expect(await readPaginatedRollout({ owner, taskId })).toEqual(
      parsePaginatedRollout(text, taskId),
    );
    expect(readFileSync(file, "utf8")).toBe(text);
    expect(existsSync("/synthetic/never-follow.jsonl")).toBe(false);
  });

  it("rejects a symlink rather than following a rollout reference", async () => {
    owner = createOwnedTemp();
    symlinkSync("/synthetic/never-follow.jsonl", path.join(owner.directory, "selected.jsonl"));
    await expect(readPaginatedRollout({ owner, taskId })).rejects.toBeDefined();
  });

  it("rejects invalid UTF-8, public permissions, oversize files and cancellation", async () => {
    owner = createOwnedTemp();
    const file = path.join(owner.directory, "selected.jsonl");
    writeFileSync(file, Buffer.from([0xff]), { mode: 0o600 });
    await expect(readPaginatedRollout({ owner, taskId })).rejects.toMatchObject({
      code: "source_malformed",
    });
    writeFileSync(file, lines());
    chmodSync(file, 0o644);
    await expect(readPaginatedRollout({ owner, taskId })).rejects.toMatchObject({
      code: "source_unavailable",
    });
    chmodSync(file, 0o600);
    writeFileSync(file, Buffer.alloc(32 * 1024 * 1024 + 1));
    await expect(readPaginatedRollout({ owner, taskId })).rejects.toMatchObject({
      code: "source_too_large",
    });
    const abort = new AbortController();
    abort.abort();
    await expect(
      readPaginatedRollout({ owner, taskId, signal: abort.signal }),
    ).rejects.toMatchObject({ code: "source_unavailable" });
  });
});
