// @vitest-environment node
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromJSONSchema } from "zod";

import { projectCodexTaskDetail } from "@/server/codex/task-projection";
import type { CodexPanelDescriptor } from "@/server/panels/registry";

type JsonObject = Record<string, unknown>;

const fixtureDirectory = fileURLToPath(new URL("../fixtures/codex-0.145.0/", import.meta.url));
const readWireSchema = fromJSONSchema(
  JSON.parse(
    readFileSync(path.join(fixtureDirectory, "ThreadReadResponse.json"), "utf8"),
  ) as Parameters<typeof fromJSONSchema>[0],
);
const observedAt = new Date("2026-09-16T00:00:00.000Z");

let fixtureRoot = "";
let workspaceRoot = "";
let outsideFile = "";

function panel(root: string | null = workspaceRoot): CodexPanelDescriptor {
  return {
    id: "codex",
    name: "Codex",
    runtime: "codex",
    adapterVersion: "codex-0.145.0",
    surfaces: ["overview", "system", "conversations"],
    configuration: {
      home: path.join(fixtureRoot, "codex-home"),
      ...(root === null ? {} : { workspaceRoot: root }),
    },
  };
}

function thread(id: string, turns: JsonObject[], cwd = workspaceRoot): JsonObject {
  return {
    id,
    sessionId: `session-${id}`,
    preview: `Preview ${id}`,
    ephemeral: false,
    modelProvider: "openai",
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_100,
    recencyAt: 1_700_000_200,
    status: { type: "idle" },
    path: path.join(fixtureRoot, `${id}.jsonl`),
    cwd,
    cliVersion: "0.145.0",
    source: "cli",
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: `Task ${id}`,
    turns,
  };
}

function turn(id: string, items: JsonObject[], status = "completed"): JsonObject {
  return { id, status, error: null, items, itemsView: "full" };
}

function userMessage(id: string, text: string): JsonObject {
  return {
    type: "userMessage",
    id,
    content: [{ type: "text", text, text_elements: [] }],
  };
}

function agentMessage(id: string, text: string, phase: "commentary" | "final_answer"): JsonObject {
  return { type: "agentMessage", id, text, phase };
}

function commandExecution(
  id: string,
  commandActions: JsonObject[],
  overrides: JsonObject = {},
): JsonObject {
  return {
    type: "commandExecution",
    id,
    command: `RAW_COMMAND_${id}`,
    commandActions,
    cwd: workspaceRoot,
    status: "completed",
    aggregatedOutput: null,
    durationMs: 12,
    exitCode: 0,
    ...overrides,
  };
}

function readAction(target: string, marker: string): JsonObject {
  return {
    type: "read",
    command: `RAW_ACTION_${marker}`,
    name: marker,
    path: target,
  };
}

function listAction(target: string | null, marker: string): JsonObject {
  return {
    type: "listFiles",
    command: `RAW_ACTION_${marker}`,
    path: target,
  };
}

function searchAction(target: string | null, marker: string): JsonObject {
  return {
    type: "search",
    command: `RAW_ACTION_${marker}`,
    path: target,
    query: `RAW_QUERY_${marker}`,
  };
}

function project(rawThread: JsonObject, descriptor = panel()) {
  const result = { thread: rawThread };
  expect(readWireSchema.safeParse(result).success).toBe(true);
  return projectCodexTaskDetail(result, {
    panel: descriptor,
    publicTaskId: "task-Public_123",
    expectedRawTaskId: rawThread.id as string,
    now: observedAt,
    operatorHome: fixtureRoot,
  });
}

function projectUnchecked(rawThread: JsonObject, descriptor = panel()) {
  return projectCodexTaskDetail(
    { thread: rawThread },
    {
      panel: descriptor,
      publicTaskId: "task-Public_123",
      expectedRawTaskId: rawThread.id as string,
      now: observedAt,
      operatorHome: fixtureRoot,
    },
  );
}

beforeEach(() => {
  fixtureRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "cockpit-process-projection-")));
  workspaceRoot = path.join(fixtureRoot, "workspace");
  mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
  mkdirSync(path.join(workspaceRoot, "assets"), { recursive: true });
  mkdirSync(path.join(fixtureRoot, "codex-home"));
  writeFileSync(path.join(workspaceRoot, "src", "readme.md"), "read me");
  writeFileSync(path.join(workspaceRoot, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(path.join(workspaceRoot, "src", "b.ts"), "export const b = 2;\n");
  writeFileSync(path.join(workspaceRoot, "src", "modify.ts"), "export const before = true;\n");
  writeFileSync(path.join(workspaceRoot, "assets", "diagram.png"), "synthetic image");
  outsideFile = path.join(fixtureRoot, "outside.txt");
  writeFileSync(outsideFile, "outside");
});

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("Codex Process projection", () => {
  it("projects every audited positive policy in stable wire order without raw payload fields", () => {
    const raw = thread("positive", [
      turn("positive-turn", [
        userMessage("user-positive", "Inspect the workspace"),
        agentMessage("commentary-positive", "Inspecting the safe workspace.", "commentary"),
        {
          type: "reasoning",
          id: "reasoning-positive",
          summary: ["First safe summary.", "Second safe summary."],
          content: ["RAW_REASONING_CONTENT_MARKER"],
        },
        { type: "plan", id: "plan-positive", text: "Read, inspect, then summarize." },
        commandExecution("read-positive", [
          readAction(path.join(workspaceRoot, "src", "readme.md"), "READ_MARKER"),
        ]),
        commandExecution("list-positive", [listAction("src", "LIST_MARKER")], {
          aggregatedOutput: "a.ts\nb.ts",
          durationMs: 20,
        }),
        commandExecution("search-positive", [searchAction("src", "SEARCH_MARKER")], {
          durationMs: 30,
          exitCode: 1,
        }),
        {
          type: "fileChange",
          id: "changes-positive",
          status: "completed",
          changes: [
            {
              path: "src/new.ts",
              kind: { type: "add" },
              diff: "--- legitimate file content\nexport const added = true;",
            },
            {
              path: "src/modify.ts",
              kind: { type: "update", move_path: null },
              diff: [
                "diff --git a/RAW_OLD_PATH b/RAW_NEW_PATH",
                "copy from RAW_COPY_SOURCE",
                "copy to RAW_COPY_TARGET",
                "Binary files a/RAW_BINARY_OLD and b/RAW_BINARY_NEW differ",
                "--- /Users/private/RAW_OLD_HEADER",
                "+++ /Users/private/RAW_NEW_HEADER",
                "@@ -1 +1 @@",
                "-export const before = true;",
                "+export const after = true;",
              ].join("\n"),
            },
            {
              path: "src/deleted.ts",
              kind: { type: "delete" },
              diff: "export const deleted = true;",
            },
          ],
        },
        {
          type: "imageView",
          id: "image-positive",
          path: path.join(workspaceRoot, "assets", "diagram.png"),
        },
        {
          type: "webSearch",
          id: "web-positive",
          query: "RAW_WEB_QUERY_MARKER",
          action: { type: "search", query: "RAW_WEB_ACTION_MARKER", queries: null },
          results: [{ title: "RAW_WEB_RESULT_MARKER" }],
        },
        agentMessage("final-positive", "Inspection complete.", "final_answer"),
      ]),
    ]);

    const detail = project(raw);
    const process = detail.turns[0]?.process;
    expect(process?.count).toBe(9);
    expect(process?.rows).toEqual([
      { type: "progress", key: "process-1", text: "Inspecting the safe workspace." },
      {
        type: "reasoning_summary",
        key: "process-2",
        text: "First safe summary.\nSecond safe summary.",
      },
      { type: "plan", key: "process-3", text: "Read, inspect, then summarize." },
      {
        type: "command",
        key: "process-4",
        label: "Command",
        preview: "Read src/readme.md",
        status: "completed",
        durationMs: 12,
        exitCode: 0,
      },
      {
        type: "command",
        key: "process-5",
        label: "Command",
        preview: "List files in src",
        status: "completed",
        durationMs: 20,
        exitCode: 0,
        output: { text: "src/a.ts\nsrc/b.ts", truncated: false },
      },
      {
        type: "command",
        key: "process-6",
        label: "Command",
        preview: "Search in src",
        status: "completed",
        durationMs: 30,
        exitCode: 1,
      },
      expect.objectContaining({
        type: "changes",
        key: "process-7",
        status: "completed",
        files: [
          { path: "src/new.ts", change: "add" },
          { path: "src/modify.ts", change: "modify" },
          { path: "src/deleted.ts", change: "delete" },
        ],
      }),
      {
        type: "tool",
        key: "process-8",
        label: "Viewed image",
        fields: [{ label: "File", value: "assets/diagram.png" }],
      },
      { type: "tool", key: "process-9", label: "Web search", fields: [] },
    ]);
    const changes = process?.rows[6];
    expect(changes?.type).toBe("changes");
    if (changes?.type === "changes") {
      expect(changes.patch).toMatchObject({ truncated: false });
      expect(changes.patch?.text).toContain("--- /dev/null\n+++ b/src/new.ts");
      expect(changes.patch?.text).toContain("+--- legitimate file content");
      expect(changes.patch?.text).toContain("--- a/src/modify.ts\n+++ b/src/modify.ts");
      expect(changes.patch?.text).toContain("--- a/src/deleted.ts\n+++ /dev/null");
    }
    expect(detail.turns[0]?.messages.at(-1)?.content).toBe("Inspection complete.");
    expect(JSON.stringify(detail)).not.toMatch(
      /RAW_|reasoning-positive|web-positive|positive-turn|Users\/private|commandActions/u,
    );
  });

  it("keeps no-final Process evidence, aggregates only identical adjacent hidden rows, and hides in-progress evidence", () => {
    const hidden = (id: string, status: "completed" | "failed"): JsonObject => ({
      type: "dynamicToolCall",
      id,
      tool: `RAW_TOOL_${id}`,
      arguments: { secret: `RAW_ARGUMENT_${id}` },
      status,
      durationMs: 5,
      contentItems: null,
      success: status === "completed",
    });
    const compact = (id: string): JsonObject => ({ type: "contextCompaction", id });
    const raw = thread("ordering", [
      turn("terminal-no-final", [
        agentMessage("progress-order", "First visible row.", "commentary"),
        hidden("hidden-a", "completed"),
        hidden("hidden-b", "completed"),
        { type: "plan", id: "plan-order", text: "Middle visible row." },
        hidden("hidden-c", "failed"),
        compact("compact-a"),
        compact("compact-b"),
      ]),
      turn(
        "unfinished",
        [
          userMessage("unfinished-user", "Current question"),
          agentMessage("unfinished-commentary", "RAW_UNFINISHED_PROCESS_MARKER", "commentary"),
          {
            type: "reasoning",
            id: "unfinished-reasoning",
            summary: ["RAW_UNFINISHED_SUMMARY_MARKER"],
            content: ["RAW_UNFINISHED_REASONING_MARKER"],
          },
        ],
        "inProgress",
      ),
    ]);

    const detail = project(raw);
    expect(detail.turns[0]?.messages.at(-1)?.content).toBe("Completed without a final answer.");
    expect(detail.turns[0]?.process?.rows).toEqual([
      { type: "progress", key: "process-1", text: "First visible row." },
      {
        type: "hidden",
        key: "process-2",
        label: "Details hidden",
        itemType: "Tool",
        status: "completed",
        count: 2,
      },
      { type: "plan", key: "process-3", text: "Middle visible row." },
      {
        type: "hidden",
        key: "process-4",
        label: "Details hidden",
        itemType: "Tool",
        status: "failed",
        count: 1,
      },
      {
        type: "hidden",
        key: "process-5",
        label: "Details hidden",
        itemType: "Activity",
        count: 2,
      },
    ]);
    expect(detail.turns[1]?.status).toBe("in-progress");
    expect(detail.turns[1]?.process).toBeNull();
    expect(JSON.stringify(detail)).not.toMatch(/RAW_TOOL|RAW_ARGUMENT|RAW_UNFINISHED/u);
  });

  it("treats Object prototype property names as unsupported item types", () => {
    const raw = thread("prototype-types", [
      turn("prototype-turn", [
        { type: "toString", id: "prototype-to-string" },
        { type: "constructor", id: "prototype-constructor" },
        { type: "__proto__", id: "prototype-proto" },
        agentMessage("prototype-final", "Safe final.", "final_answer"),
      ]),
    ]);

    const detail = projectUnchecked(raw);
    expect(detail.turns[0]?.process?.rows).toEqual([
      {
        type: "hidden",
        key: "process-1",
        label: "Unsupported activity",
        itemType: "Activity",
        count: 3,
      },
    ]);
    expect(detail.turns[0]?.process?.omitted).toContainEqual({
      reason: "unsupported",
      label: "Unsupported activity omitted",
      count: 3,
    });
  });

  it("keeps only allowlisted image-generation terminal status and hides its payload", () => {
    const imageGeneration = (id: string, status: string): JsonObject => ({
      type: "imageGeneration",
      id,
      status,
      result: `RAW_IMAGE_RESULT_${id}`,
      revisedPrompt: `RAW_REVISED_PROMPT_${id}`,
      savedPath: outsideFile,
    });
    const raw = thread("image-generation", [
      turn("image-generation-turn", [
        imageGeneration("completed", "completed"),
        imageGeneration("declined", "declined"),
        imageGeneration("unknown", "RAW_UNSAFE_STATUS_MARKER"),
        agentMessage("image-generation-final", "Safe final.", "final_answer"),
      ]),
    ]);

    const detail = project(raw);
    expect(detail.turns[0]?.process?.rows).toEqual([
      {
        type: "hidden",
        key: "process-1",
        label: "Details hidden",
        itemType: "Tool",
        status: "completed",
        count: 1,
      },
      {
        type: "hidden",
        key: "process-2",
        label: "Details hidden",
        itemType: "Tool",
        status: "declined",
        count: 1,
      },
      {
        type: "hidden",
        key: "process-3",
        label: "Details hidden",
        itemType: "Tool",
        count: 1,
      },
    ]);
    expect(JSON.stringify(detail)).not.toMatch(
      /RAW_IMAGE_RESULT|RAW_REVISED_PROMPT|RAW_UNSAFE_STATUS|outside\.txt/u,
    );
  });

  it("keeps terminal evidence but hides unsafe path, move, multi-action, and output near misses", () => {
    const outsideImage = path.join(fixtureRoot, "outside.png");
    writeFileSync(outsideImage, "outside image");
    const missingRead = path.join(workspaceRoot, "src", "missing.ts");
    const raw = thread("near-misses", [
      turn("near-miss-turn", [
        commandExecution("outside-read", [readAction(outsideFile, "OUTSIDE_READ")]),
        commandExecution("missing-read", [readAction(missingRead, "MISSING_READ")]),
        commandExecution(
          "multiple",
          [listAction("src", "MULTI_ONE"), searchAction("src", "MULTI_TWO")],
          { aggregatedOutput: "a.ts\nRAW_MULTIPLE_OUTPUT_MARKER" },
        ),
        commandExecution("unsafe-output", [listAction("src", "UNSAFE_OUTPUT")], {
          aggregatedOutput: "a.ts\n../RAW_ESCAPE_OUTPUT_MARKER",
        }),
        commandExecution("unknown", [{ type: "unknown", command: "RAW_UNKNOWN_ACTION_MARKER" }]),
        {
          type: "fileChange",
          id: "move-change",
          status: "completed",
          changes: [
            {
              path: "src/modify.ts",
              kind: { type: "update", move_path: "src/RAW_MOVE_TARGET_MARKER.ts" },
              diff: "RAW_MOVE_PATCH_MARKER",
            },
          ],
        },
        {
          type: "fileChange",
          id: "outside-change",
          status: "completed",
          changes: [
            {
              path: outsideFile,
              kind: { type: "update", move_path: null },
              diff: "RAW_OUTSIDE_PATCH_MARKER",
            },
          ],
        },
        {
          type: "fileChange",
          id: "invalid-update-patch",
          status: "completed",
          changes: [
            {
              path: "src/modify.ts",
              kind: { type: "update", move_path: null },
              diff: [
                "@@ -1 +1 @@",
                "-export const before = true;",
                "+export const after = true;",
                "diff --git a/RAW_LATE_HEADER b/RAW_LATE_HEADER",
                "Binary files a/RAW_LATE_BINARY and b/RAW_LATE_BINARY differ",
              ].join("\n"),
            },
          ],
        },
        { type: "imageView", id: "outside-image", path: outsideImage },
        agentMessage("near-miss-final", "Safe final.", "final_answer"),
      ]),
    ]);

    const detail = project(raw);
    const rows = detail.turns[0]?.process?.rows ?? [];
    expect(rows.slice(0, 3)).toEqual([
      expect.objectContaining({ type: "command", label: "Command", status: "completed" }),
      expect.objectContaining({ type: "command", label: "Command", status: "completed" }),
      expect.objectContaining({ type: "command", label: "Command", status: "completed" }),
    ]);
    for (const row of rows.slice(0, 3)) {
      expect(row).not.toHaveProperty("preview");
      expect(row).not.toHaveProperty("output");
    }
    expect(rows[3]).toMatchObject({
      type: "command",
      preview: "List files in src",
      status: "completed",
    });
    expect(rows[3]).not.toHaveProperty("output");
    expect(rows[4]).not.toHaveProperty("preview");
    expect(rows[5]).toEqual({
      type: "hidden",
      key: "process-6",
      label: "Details hidden",
      itemType: "Changes",
      status: "completed",
      count: 2,
    });
    expect(rows[6]).toMatchObject({
      type: "changes",
      status: "completed",
      files: [{ path: "src/modify.ts", change: "modify" }],
    });
    expect(rows[6]).not.toHaveProperty("patch");
    expect(rows[7]).toMatchObject({
      type: "hidden",
      label: "Details hidden",
      itemType: "Tool",
    });
    expect(JSON.stringify(detail)).not.toMatch(/RAW_|outside\.txt|outside\.png/u);
  });

  it("never lets recorded cwd or Project labels substitute for a missing approved root", () => {
    const raw = thread("missing-root", [
      turn("missing-root-turn", [
        commandExecution("missing-root-read", [
          readAction(path.join(workspaceRoot, "src", "readme.md"), "MISSING_ROOT_READ"),
        ]),
        commandExecution("missing-root-list", [listAction("src", "MISSING_ROOT_LIST")], {
          aggregatedOutput: "a.ts",
        }),
        {
          type: "fileChange",
          id: "missing-root-change",
          status: "completed",
          changes: [
            {
              path: "src/modify.ts",
              kind: { type: "update", move_path: null },
              diff: "RAW_MISSING_ROOT_PATCH_MARKER",
            },
          ],
        },
        {
          type: "imageView",
          id: "missing-root-image",
          path: path.join(workspaceRoot, "assets", "diagram.png"),
        },
        agentMessage("missing-root-final", "Safe final.", "final_answer"),
      ]),
    ]);

    const detail = project(raw, panel(null));
    const rows = detail.turns[0]?.process?.rows ?? [];
    expect(rows[0]).toMatchObject({ type: "command", status: "completed" });
    expect(rows[1]).toMatchObject({ type: "command", status: "completed" });
    expect(rows[0]).not.toHaveProperty("preview");
    expect(rows[1]).not.toHaveProperty("preview");
    expect(rows[1]).not.toHaveProperty("output");
    expect(rows[2]).toMatchObject({ type: "hidden", itemType: "Changes" });
    expect(rows[3]).toMatchObject({ type: "hidden", itemType: "Tool" });
    expect(JSON.stringify(detail)).not.toMatch(/RAW_|readme\.md|modify\.ts|diagram\.png/u);
  });

  it("rejects list output that canonicalizes to the workspace root", () => {
    symlinkSync(workspaceRoot, path.join(workspaceRoot, "src", "root-alias"));
    const raw = thread("root-output", [
      turn("root-output-turn", [
        commandExecution("root-output-command", [listAction("src", "ROOT_OUTPUT")], {
          aggregatedOutput: "root-alias",
        }),
      ]),
    ]);

    const detail = project(raw);
    expect(detail.turns[0]?.process?.rows[0]).toMatchObject({
      type: "command",
      preview: "List files in src",
      status: "completed",
    });
    expect(detail.turns[0]?.process?.rows[0]).not.toHaveProperty("output");
    expect(detail.turns[0]?.process?.omitted).toContainEqual(
      expect.objectContaining({ reason: "policy" }),
    );
  });

  it("keeps safe Changes metadata but omits a non-hunk update patch", () => {
    const raw = thread("no-hunk-update", [
      turn("no-hunk-turn", [
        {
          type: "fileChange",
          id: "no-hunk-change",
          status: "completed",
          changes: [
            {
              path: "src/modify.ts",
              kind: { type: "update", move_path: null },
              diff: "RAW_NO_HUNK_PATCH_MARKER",
            },
          ],
        },
      ]),
    ]);

    const detail = project(raw);
    expect(detail.turns[0]?.process?.rows[0]).toMatchObject({
      type: "changes",
      status: "completed",
      files: [{ path: "src/modify.ts", change: "modify" }],
    });
    expect(detail.turns[0]?.process?.rows[0]).not.toHaveProperty("patch");
    expect(detail.turns[0]?.process?.omitted).toContainEqual(
      expect.objectContaining({ reason: "policy" }),
    );
    expect(JSON.stringify(detail)).not.toContain("RAW_NO_HUNK_PATCH_MARKER");
  });

  it("does not count transcript-only items against the Process source cap", () => {
    const messages = Array.from({ length: 201 }, (_, index) =>
      userMessage(`user-only-${index}`, `message-${index}`),
    );
    const detail = project(thread("transcript-only-cap", [turn("transcript-only-turn", messages)]));

    expect(detail.turns[0]?.messages).toHaveLength(202);
    expect(detail.turns[0]?.process).toBeNull();
    expect(detail.turns[0]?.omitted).toEqual([]);
  });

  it("enforces per-field, per-turn, output-line, and change-path caps with omissions", () => {
    const plans = Array.from({ length: 205 }, (_, index): JsonObject => ({
      type: "plan",
      id: `plan-cap-${index}`,
      text: index === 204 ? `${"x".repeat(4_001)}RAW_PROCESS_SUFFIX_MARKER` : `plan-${index}`,
    }));
    const overlongOutput = Array.from({ length: 121 }, () => "a.ts").join("\n");
    const longOutputName = `${"l".repeat(70)}.ts`;
    writeFileSync(path.join(workspaceRoot, "src", longOutputName), "long output fixture");
    const overbyteOutput = Array.from({ length: 120 }, () => longOutputName).join("\n");
    const overlinePatch = [
      "@@ -1,150 +1,150 @@",
      ...Array.from({ length: 150 }, () => "-old"),
      ...Array.from({ length: 150 }, () => "+new"),
    ].join("\n");
    const changes = Array.from({ length: 51 }, (_, index) => ({
      path: `src/generated-${index}.ts`,
      kind: { type: "add" },
      diff: "",
    }));
    const raw = thread("caps", [
      turn("row-and-field-cap", plans),
      turn("reasoning-parts-cap", [
        {
          type: "reasoning",
          id: "reasoning-cap-item",
          summary: Array.from({ length: 101 }, (_, index) => `summary-${index}`),
          content: ["RAW_REASONING_CAP_CONTENT"],
        },
      ]),
      turn("output-cap", [
        commandExecution("output-cap-command", [listAction("src", "OUTPUT_CAP")], {
          aggregatedOutput: overlongOutput,
        }),
      ]),
      turn("change-cap", [
        {
          type: "fileChange",
          id: "change-cap-item",
          status: "completed",
          changes,
        },
      ]),
      turn("output-byte-cap", [
        commandExecution("output-byte-command", [listAction("src", "OUTPUT_BYTE_CAP")], {
          aggregatedOutput: overbyteOutput,
        }),
      ]),
      turn("patch-line-cap", [
        {
          type: "fileChange",
          id: "patch-line-cap-item",
          status: "completed",
          changes: [
            {
              path: "src/modify.ts",
              kind: { type: "update", move_path: null },
              diff: overlinePatch,
            },
          ],
        },
      ]),
    ]);

    const detail = project(raw);
    const cappedPlans = detail.turns[0]?.process;
    expect(cappedPlans?.count).toBe(40);
    expect(cappedPlans?.rows[0]).toMatchObject({ type: "plan", text: "plan-165" });
    expect(cappedPlans?.rows.at(-1)).toMatchObject({ type: "plan", text: "x".repeat(4_000) });
    expect(cappedPlans?.omitted).toContainEqual(expect.objectContaining({ reason: "limit" }));

    expect(detail.turns[1]?.process?.rows[0]).toMatchObject({
      type: "reasoning_summary",
      text: expect.stringMatching(/^summary-1\n/u),
    });
    expect(detail.turns[1]?.process?.omitted).toContainEqual(
      expect.objectContaining({ reason: "limit" }),
    );

    const outputRow = detail.turns[2]?.process?.rows[0];
    expect(outputRow).toMatchObject({
      type: "command",
      preview: "List files in src",
      status: "completed",
    });
    expect(outputRow).not.toHaveProperty("output");
    expect(detail.turns[2]?.process?.omitted).toContainEqual(
      expect.objectContaining({ reason: "limit" }),
    );

    expect(detail.turns[3]?.process?.rows[0]).toMatchObject({
      type: "hidden",
      label: "Details hidden",
      itemType: "Changes",
      status: "completed",
    });
    expect(detail.turns[3]?.process?.omitted).toContainEqual(
      expect.objectContaining({ reason: "limit" }),
    );

    expect(detail.turns[4]?.process?.rows[0]).toMatchObject({
      type: "command",
      preview: "List files in src",
    });
    expect(detail.turns[4]?.process?.rows[0]).not.toHaveProperty("output");
    expect(detail.turns[4]?.process?.omitted).toContainEqual(
      expect.objectContaining({ reason: "limit" }),
    );

    const patchRow = detail.turns[5]?.process?.rows[0];
    expect(patchRow).toMatchObject({ type: "changes" });
    if (patchRow?.type === "changes") expect(patchRow.patch?.truncated).toBe(true);
    expect(detail.turns[5]?.process?.omitted).toContainEqual(
      expect.objectContaining({ reason: "limit" }),
    );
    expect(JSON.stringify(detail)).not.toMatch(/RAW_(?:PROCESS_SUFFIX|REASONING_CAP)/u);
  });

  it("keeps the newest 300 task rows", () => {
    const rowTurns = Array.from({ length: 8 }, (_, turnIndex) =>
      turn(
        `task-row-cap-${turnIndex}`,
        Array.from({ length: 40 }, (_, rowIndex): JsonObject => ({
          type: "plan",
          id: `row-${turnIndex}-${rowIndex}`,
          text: `turn-${turnIndex}-plan-${rowIndex}`,
        })),
      ),
    );
    const raw = thread("task-row-budget", rowTurns);

    const detail = project(raw);
    const rowCount = detail.turns.reduce(
      (total, projected) => total + (projected.process?.rows.length ?? 0),
      0,
    );
    expect(rowCount).toBe(300);
    expect(detail.turns[0]?.process?.rows[0]).toMatchObject({
      type: "plan",
      text: "turn-0-plan-20",
    });
    expect(detail.turns[0]?.process?.omitted).toContainEqual(
      expect.objectContaining({ reason: "limit" }),
    );
  });

  it("preserves main messages when Process text is pruned", () => {
    const textPressure = turn("process-text-cap", [
      userMessage("text-cap-user", "Keep this main question."),
      ...Array.from({ length: 17 }, (_, index): JsonObject => ({
        type: "plan",
        id: `large-plan-${index}`,
        text: `${index.toString().padStart(2, "0")}-${"x".repeat(3_997)}`,
      })),
      agentMessage("text-cap-final", "Keep this final answer.", "final_answer"),
    ]);
    const detail = project(thread("process-text-budget", [textPressure]));

    expect(detail.turns[0]?.messages.map((message) => message.content)).toEqual([
      "Keep this main question.",
      "Keep this final answer.",
    ]);
    expect(detail.turns[0]?.process?.rows.length).toBeLessThan(17);
    expect(detail.turns[0]?.process?.omitted).toContainEqual(
      expect.objectContaining({ reason: "limit" }),
    );
  });

  it("drops old patch detail before top-level Process rows under the 64 KiB budget", () => {
    const largeHunk = ["@@ -1 +1 @@", `-${"a".repeat(13_000)}`, `+${"b".repeat(13_000)}`].join(
      "\n",
    );
    const changes = Array.from({ length: 3 }, (_, index): JsonObject => ({
      type: "fileChange",
      id: `patch-pressure-${index}`,
      status: "completed",
      changes: [
        {
          path: "src/modify.ts",
          kind: { type: "update", move_path: null },
          diff: largeHunk,
        },
      ],
    }));
    const raw = thread("nested-budget", [
      turn("nested-budget-turn", [
        userMessage("nested-budget-user", "Keep this question too."),
        ...changes,
        agentMessage("nested-budget-final", "Keep this answer too.", "final_answer"),
      ]),
    ]);

    const detail = project(raw);
    const process = detail.turns[0]?.process;
    expect(process?.rows).toHaveLength(3);
    expect(process?.rows.every((row) => row.type === "changes")).toBe(true);
    expect(process?.rows.some((row) => row.type === "changes" && row.patch === undefined)).toBe(
      true,
    );
    expect(process?.rows.some((row) => row.type === "changes" && row.patch !== undefined)).toBe(
      true,
    );
    expect(process?.omitted).toContainEqual(expect.objectContaining({ reason: "limit" }));
    expect(detail.turns[0]?.messages.map((message) => message.content)).toEqual([
      "Keep this question too.",
      "Keep this answer too.",
    ]);
  });
});
