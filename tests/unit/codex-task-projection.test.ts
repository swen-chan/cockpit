// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { fromJSONSchema } from "zod";

import {
  projectCodexProjectLabel,
  projectCodexTaskDetail,
  projectCodexTaskPage,
} from "@/server/codex/task-projection";
import { createPanelTokenCodec } from "@/server/panels/opaque-token";
import type { CodexPanelDescriptor } from "@/server/panels/registry";

type JsonObject = Record<string, unknown>;

const fixtureDirectory = fileURLToPath(new URL("../fixtures/codex-0.145.0/", import.meta.url));
const listWireSchema = fromJSONSchema(
  JSON.parse(
    readFileSync(path.join(fixtureDirectory, "ThreadListResponse.json"), "utf8"),
  ) as Parameters<typeof fromJSONSchema>[0],
);
const readWireSchema = fromJSONSchema(
  JSON.parse(
    readFileSync(path.join(fixtureDirectory, "ThreadReadResponse.json"), "utf8"),
  ) as Parameters<typeof fromJSONSchema>[0],
);

const panel = {
  id: "codex",
  name: "Codex",
  runtime: "codex",
  adapterVersion: "codex-0.145.0",
  surfaces: ["overview", "system", "conversations"],
  configuration: { home: "/Users/operator/.codex", workspaceRoot: "/srv/project" },
} satisfies CodexPanelDescriptor;
const scope = { panelId: "codex", runtime: "codex", adapterVersion: "codex-0.145.0" } as const;
const observedAt = new Date("2026-09-16T00:00:00.000Z");

function thread(id: string, overrides: JsonObject = {}): JsonObject {
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
    path: `/Users/operator/.codex/sessions/${id}.jsonl`,
    cwd: `/Users/operator/work/${id}`,
    cliVersion: "0.145.0",
    source: "cli",
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: `Task ${id}`,
    turns: [],
    ...overrides,
  };
}

function turn(
  id: string,
  items: JsonObject[],
  status = "completed",
  overrides: JsonObject = {},
): JsonObject {
  return { id, status, error: null, items, ...overrides };
}

function textUser(id: string, text: string): JsonObject {
  return {
    type: "userMessage",
    id,
    content: [{ type: "text", text, text_elements: [] }],
  };
}

function finalAnswer(
  id: string,
  text: string,
  phase: "final_answer" | "commentary" | null = "final_answer",
): JsonObject {
  return { type: "agentMessage", id, text, phase };
}

function assertWireList(result: JsonObject): JsonObject {
  expect(listWireSchema.safeParse(result).success).toBe(true);
  return result;
}

function assertWireRead(result: JsonObject): JsonObject {
  expect(readWireSchema.safeParse(result).success).toBe(true);
  return result;
}

function detailResult(rawThread: JsonObject): JsonObject {
  return assertWireRead({ thread: rawThread });
}

function projectDetail(rawThread: JsonObject, publicTaskId = "task-Public_123") {
  return projectCodexTaskDetail(detailResult(rawThread), {
    panel,
    publicTaskId,
    expectedRawTaskId: rawThread.id as string,
    now: observedAt,
    operatorHome: "/Users/operator",
  });
}

describe("Codex task projection", () => {
  it("projects at most the returned five rows in source order and filters without backfilling", () => {
    const tokens = createPanelTokenCodec(new Uint8Array(32).fill(7));
    const raw = assertWireList({
      data: [
        thread("first", {
          source: "vscode",
          cwd: "/Users/operator/work/alpha",
          status: { type: "active", activeFlags: ["waitingOnUserInput"] },
          unknownMarker: "RAW_LIST_MARKER",
        }),
        thread("ephemeral", { ephemeral: true, source: "appServer" }),
        thread("parent", { parentThreadId: "raw-parent", source: "cli" }),
        thread("exec", { source: "exec" }),
        thread("last", {
          source: "appServer",
          cwd: "/Users/operator/work/omega",
          name: "x".repeat(501),
          preview: "p".repeat(1_001),
          recencyAt: null,
          status: { type: "systemError" },
        }),
      ],
      nextCursor: "raw-private-cursor",
    });

    const page = projectCodexTaskPage(raw, {
      panel,
      tokens,
      now: observedAt,
      operatorHome: "/Users/operator",
    });

    expect(page.items).toHaveLength(2);
    expect(
      page.items.map((item) => ({
        source: item.source,
        project: item.projectLabel,
        status: item.status,
      })),
    ).toEqual([
      { source: "VS Code", project: "alpha", status: "active" },
      { source: "App Server", project: "omega", status: "error" },
    ]);
    expect(tokens.decodeTask(scope, page.items[0]?.id ?? "")).toBe("first");
    expect(tokens.decodeTask(scope, page.items[1]?.id ?? "")).toBe("last");
    expect(tokens.decodeCursor(scope, page.nextCursor ?? "")).toBe("raw-private-cursor");
    expect(page.items[1]).toMatchObject({
      title: null,
      preview: null,
      lastActivity: "2023-11-14T22:15:00.000Z",
    });
    expect(JSON.stringify(page)).not.toMatch(/RAW_LIST_MARKER|raw-private-cursor|raw-parent/u);
  });

  it("derives Project only from one bounded safe final segment", () => {
    expect(
      projectCodexProjectLabel("/Users/operator/work/cockpit/", panel, "/Users/operator"),
    ).toBe("cockpit");

    for (const cwd of [
      "/",
      "/Users/operator",
      "/Users/operator/",
      "/Users/operator/.codex",
      "/Users/alice",
      "/home/alice",
      "/root",
      "relative/cockpit",
      "C:\\Users\\operator\\cockpit",
      "\\\\server\\share\\cockpit",
      "//server/share/cockpit",
      "file:///Users/operator/work/cockpit",
      "/Users/operator/work/credentials.json",
      "/Users/operator/work/token=private-value",
      "/Users/operator/work/safe\u202Ehidden",
      "/Users/operator/work/safe\u2028hidden",
      "/Users/operator/work/safe\u2029hidden",
      "/Users/operator/work/safe\u001b[31m",
      `/Users/operator/work/${"x".repeat(1_025)}`,
      "/Users/operator/work/\ud800",
      "/Users/operator/work/../cockpit",
    ]) {
      expect(projectCodexProjectLabel(cwd, panel, "/Users/operator"), cwd).toBeNull();
    }
  });

  it("excludes pinned spawned-child markers without treating a normal fork as a sub-Agent", () => {
    const tokens = createPanelTokenCodec(new Uint8Array(32).fill(8));
    const raw = assertWireList({
      data: [
        thread("nickname-child", { agentNickname: "worker-one", source: "cli" }),
        thread("role-child", { agentRole: "reviewer", source: "cli" }),
        thread("normal-fork", { forkedFromId: "fork-parent", source: "cli" }),
      ],
      nextCursor: null,
    });

    const page = projectCodexTaskPage(raw, {
      panel,
      tokens,
      now: observedAt,
      operatorHome: "/Users/operator",
    });

    expect(page.items).toHaveLength(1);
    expect(tokens.decodeTask(scope, page.items[0]?.id ?? "")).toBe("normal-fork");
    expect(JSON.stringify(page)).not.toMatch(/worker-one|reviewer|fork-parent/u);
  });

  it("projects one ordered user message, exact terminal finals, placeholders, and fixed statuses", () => {
    const user = {
      type: "userMessage",
      id: "raw-user-id",
      clientId: "RAW_CLIENT_MARKER",
      content: [
        { type: "text", text: "First\r\nsecond\u001b[31m!", text_elements: [] },
        { type: "image", url: "https://private.invalid/RAW_IMAGE_MARKER" },
        { type: "localImage", path: "/Users/operator/RAW_LOCAL_IMAGE_MARKER" },
        { type: "audio", url: "https://private.invalid/RAW_AUDIO_MARKER" },
        { type: "localAudio", path: "/Users/operator/RAW_LOCAL_AUDIO_MARKER" },
        { type: "skill", name: "RAW_SKILL_MARKER", path: "/Users/operator/.codex/skills/private" },
        { type: "mention", name: "RAW_MENTION_MARKER", path: "/Users/operator/private" },
      ],
    };
    const rawThread = thread("raw-detail-id", {
      cwd: "/Users/operator/work/cockpit",
      name: "Safe task title",
      preview: "Safe task preview",
      turns: [
        turn("raw-turn-1", [
          user,
          finalAnswer("raw-commentary", "Working safely", "commentary"),
          {
            type: "reasoning",
            id: "raw-reasoning-id",
            summary: ["Checked the safe boundary"],
            content: ["RAW_REASONING_CONTENT_MARKER"],
          },
          finalAnswer("raw-final", "Done at /Users/operator/private"),
          textUser("post-final-user", "Follow-up after final"),
        ]),
        turn("raw-turn-2", [textUser("user-2", "Second question")], "interrupted"),
        turn(
          "raw-turn-3",
          [
            textUser("user-3", "Third question"),
            finalAnswer("phase-absent", "RAW_PHASELESS_MARKER", null),
          ],
          "failed",
        ),
        turn(
          "raw-turn-4",
          [
            textUser("user-4", "Current question"),
            finalAnswer("unfinished-final", "RAW_UNFINISHED_FINAL_MARKER"),
          ],
          "inProgress",
        ),
      ],
    });

    const detail = projectDetail(rawThread);

    expect(detail.turns.map((projected) => projected.status)).toEqual([
      "completed",
      "interrupted",
      "failed",
      "in-progress",
    ]);
    expect(detail.turns[0]?.messages).toEqual([
      {
        key: "message-1",
        role: "user",
        content: [
          "First\nsecond!",
          "Image input omitted",
          "Image input omitted",
          "Audio input omitted",
          "Audio input omitted",
          "Skill input omitted",
          "Mention input omitted",
        ].join("\n"),
      },
      { key: "message-2", role: "assistant", content: "Done at <local-path>" },
      { key: "message-3", role: "user", content: "Follow-up after final" },
    ]);
    expect(detail.turns[1]?.messages.at(-1)?.content).toBe("Interrupted before a final answer.");
    expect(detail.turns[2]?.messages.at(-1)?.content).toBe("Failed before a final answer.");
    expect(detail.turns[3]?.messages).toEqual([
      { key: "message-8", role: "user", content: "Current question" },
      { key: "message-9", role: "status", content: "Still in progress; refresh later" },
    ]);
    expect(detail.turns[0]?.process).toMatchObject({
      count: 2,
      rows: [
        { type: "progress", text: "Working safely" },
        { type: "reasoning_summary", text: "Checked the safe boundary" },
      ],
    });
    expect(detail.turns.slice(1).every((projected) => projected.process === null)).toBe(true);
    expect(JSON.stringify(detail)).not.toMatch(
      /raw-detail-id|raw-turn|RAW_(?:CLIENT|IMAGE|LOCAL|AUDIO|SKILL|MENTION|REASONING|PHASELESS|UNFINISHED)/u,
    );
  });

  it("fails closed on mismatched identity and explicitly incomplete turn items", () => {
    const complete = thread("raw-bound-id", {
      turns: [
        turn("turn-complete", [textUser("user", "Question")], "completed", { itemsView: "full" }),
      ],
    });
    const raw = detailResult(complete);
    expect(() =>
      projectCodexTaskDetail(raw, {
        panel,
        publicTaskId: "task-Public_123",
        expectedRawTaskId: "different-raw-id",
        now: observedAt,
        operatorHome: "/Users/operator",
      }),
    ).toThrowError(expect.objectContaining({ code: "protocol_violation" }));

    for (const itemsView of ["summary", "notLoaded"] as const) {
      const incomplete = thread(`raw-${itemsView}`, {
        turns: [turn(`turn-${itemsView}`, [], "completed", { itemsView })],
      });
      expect(() => projectDetail(incomplete)).toThrowError(
        expect.objectContaining({
          code: "protocol_violation",
        }),
      );
    }
  });

  it("removes terminal controls and private paths, and fails residual credentials closed", () => {
    const unsafe = [
      "ordinary https://example.com/docs and src/file.ts",
      "prefix postgres://alice:s3cr3t@host/db suffix",
      "https://example.com/private?token=supersecret",
      "file:///Users/operator/private.txt",
      "/root/private.txt C:\\Users\\operator\\secret.txt \\\\server\\share\\secret.txt",
      "open /Users/alice/My Project/file.ts RAW_PATH_SUFFIX_MARKER",
      "workspace /srv/project/src/a.ts RAW_WORKSPACE_PATH_MARKER",
      "temporary /private/tmp/file.txt RAW_PRIVATE_TMP_MARKER",
      "cwd:/private/tmp/file.txt RAW_CWD_PATH_MARKER",
      "repeated ///private/tmp/file.txt RAW_REPEATED_SLASH_MARKER",
      "before\u001b]0;RAW_OSC_MARKER\u0007after",
      "before\u001bPRAW_DCS_MARKER\u001b\\after",
      "before\u001b(0after",
      "before\u001b]RAW_UNCLOSED_OSC_MARKER",
      "\ud800",
    ].map((text, index) => ({ type: "text", text, text_elements: [], index }));
    const rawThread = thread("raw-safety", {
      turns: [
        turn("turn-safety", [
          {
            type: "userMessage",
            id: "user-safety",
            content: unsafe,
          },
        ]),
      ],
    });

    const detail = projectDetail(rawThread);
    const content = detail.turns[0]?.messages[0]?.content ?? "";
    expect(content).toContain("ordinary https://example.com/docs and src/file.ts");
    expect(content).toContain("prefix [REDACTED] suffix");
    expect(content.match(/\[REDACTED\]/gu)).toHaveLength(2);
    expect(content).toContain("<local-path>");
    expect(content).toContain("beforeafter");
    expect(content).not.toMatch(
      /user:pass|token=|\/Users\/operator|\/root|C:\\Users|server\\share|file:|RAW_|\ud800/u,
    );
    expect(detail.turns[0]?.omitted).toEqual([
      { reason: "policy", label: "Details hidden by policy", count: 14 },
    ]);
  });

  it("keeps the newest 100 turns and newest transcript messages within both budgets", () => {
    const turns = Array.from({ length: 101 }, (_, index) =>
      turn(`turn-${index}`, [
        textUser(`user-${index}`, `question-${index}`),
        finalAnswer(`answer-${index}`, `answer-${index}`),
      ]),
    );
    const cappedTurns = projectDetail(thread("raw-turn-budget", { turns }));
    expect(cappedTurns.turns).toHaveLength(100);
    expect(cappedTurns.turns[0]?.messages[0]?.content).toBe("question-1");
    expect(cappedTurns.turns.at(-1)?.messages.at(-1)?.content).toBe("answer-100");
    expect(cappedTurns.omitted).toEqual([
      { reason: "limit", label: "Content omitted by limit", count: 1 },
    ]);

    const manyMessages = Array.from({ length: 100 }, (_, turnIndex) =>
      turn(
        `many-${turnIndex}`,
        [0, 1, 2]
          .map((messageIndex) =>
            textUser(`user-${turnIndex}-${messageIndex}`, `message-${turnIndex}-${messageIndex}`),
          )
          .concat([finalAnswer(`answer-${turnIndex}`, `answer-${turnIndex}`)]),
      ),
    );
    const countCapped = projectDetail(thread("raw-message-budget", { turns: manyMessages }));
    expect(countCapped.turns.flatMap((projected) => projected.messages)).toHaveLength(250);
    expect(countCapped.turns.at(-1)?.messages.at(-1)?.content).toBe("answer-99");
    expect(
      countCapped.turns.some((projected) =>
        projected.omitted.some((note) => note.reason === "limit"),
      ),
    ).toBe(true);

    const wide = "😀".repeat(16_384);
    const byteCapped = projectDetail(
      thread("raw-byte-budget", {
        turns: [
          turn("byte-turn", [
            textUser("wide-1", wide),
            textUser("wide-2", wide),
            textUser("wide-3", wide),
            textUser("wide-4", wide),
            textUser("wide-5", wide),
            finalAnswer("byte-final", "done"),
          ]),
        ],
      }),
    );
    const messages = byteCapped.turns[0]?.messages ?? [];
    const bytes = messages.reduce(
      (total, message) => total + Buffer.byteLength(message.content),
      0,
    );
    expect(messages).toHaveLength(4);
    expect(bytes).toBeLessThanOrEqual(256 * 1_024);
    expect(messages.at(-1)?.content).toBe("done");
    expect(byteCapped.turns[0]?.omitted).toContainEqual({
      reason: "limit",
      label: "Content omitted by limit",
      count: 2,
    });
  });

  it("bounds a single message without leaking the discarded suffix", () => {
    const marker = "RAW_OVERSIZE_SUFFIX_MARKER";
    const detail = projectDetail(
      thread("raw-field-budget", {
        turns: [turn("field-turn", [finalAnswer("field-final", `${"x".repeat(20_000)}${marker}`)])],
      }),
    );
    const message = detail.turns[0]?.messages[0];
    expect(Array.from(message?.content ?? "")).toHaveLength(20_000);
    expect(message?.content).not.toContain(marker);
    expect(detail.turns[0]?.omitted).toEqual([
      { reason: "limit", label: "Content omitted by limit", count: 1 },
    ]);
  });

  it("prunes oldest messages when JSON escaping would exceed the serialized DTO cap", () => {
    const escaping = "\\".repeat(20_000);
    const newestFinal = "\\".repeat(2_100);
    const items = Array.from({ length: 13 }, (_, index) => textUser(`escaped-${index}`, escaping));
    items.push(finalAnswer("escaped-final", newestFinal));
    const detail = projectDetail(
      thread("raw-serialized-budget", {
        turns: [turn("serialized-turn", items)],
      }),
    );

    expect(Buffer.byteLength(JSON.stringify(detail))).toBeLessThanOrEqual(512 * 1_024);
    expect(detail.turns[0]?.messages.length).toBeLessThan(14);
    expect(detail.turns[0]?.messages.at(-1)?.content).toBe(newestFinal);
    expect(detail.turns[0]?.omitted).toContainEqual({
      reason: "limit",
      label: "Content omitted by limit",
      count: 1,
    });
  });
});
