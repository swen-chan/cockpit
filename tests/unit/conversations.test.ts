import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { conversationPageSchema, conversationSchema } from "@/contracts/source-result";
import { readConversationPage, readConversationTranscript } from "@/server/adapters/conversations";
import type { HermesContext } from "@/server/config/hermes-context";
import type { PrivateSourceManifest } from "@/server/config/source-manifest";
import { toSafeDiagnostic } from "@/server/security/errors";

const manifest: PrivateSourceManifest = {
  configRelativePath: "settings.yaml",
  conversation: {
    databaseRelativePath: "conversation-store.sqlite",
    sessionTable: "conversation_records",
    sessionColumns: {
      id: "record_id",
      source: "origin_kind",
      title: "headline",
      startedAt: "created_time",
      endedAt: "finished_time",
      lastActivityAt: "last_seen",
      messageCount: "visible_count",
      toolCallCount: "tool_count",
      model: "model_name",
      profileName: "profile_name",
      workspace: "work_dir",
      hidden: "is_hidden",
      archived: "is_archived",
      embeddedPrompt: "legacy_body",
    },
    messages: {
      table: "message_records",
      columns: {
        id: "message_id",
        sessionId: "conversation_ref",
        role: "speaker",
        content: "body",
        toolName: "tool_label",
        timestamp: "occurred_at",
        active: "is_active",
        compacted: "is_compacted",
        displayKind: "view_kind",
      },
    },
  },
};

describe("conversation adapter", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function fixture(): { context: HermesContext; database: Database.Database } {
    const home = mkdtempSync(path.join(tmpdir(), "cockpit-conversations-"));
    roots.push(home);
    const database = new Database(path.join(home, manifest.conversation.databaseRelativePath));
    database.exec(`
      CREATE TABLE conversation_records (
        record_id TEXT PRIMARY KEY,
        origin_kind TEXT NOT NULL,
        headline TEXT,
        created_time REAL NOT NULL,
        finished_time REAL,
        last_seen REAL,
        visible_count INTEGER,
        tool_count INTEGER,
        model_name TEXT,
        profile_name TEXT,
        work_dir TEXT,
        is_hidden INTEGER NOT NULL DEFAULT 0,
        is_archived INTEGER NOT NULL DEFAULT 0,
        legacy_body TEXT
      );
      CREATE TABLE message_records (
        message_id INTEGER PRIMARY KEY,
        conversation_ref TEXT NOT NULL,
        speaker TEXT NOT NULL,
        body TEXT,
        tool_label TEXT,
        occurred_at REAL NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        is_compacted INTEGER NOT NULL DEFAULT 0,
        view_kind TEXT,
        reasoning TEXT,
        api_payload TEXT,
        raw_calls TEXT
      );
    `);
    return {
      context: { home, profile: "default", profileKind: "default", source: "platform-default" },
      database,
    };
  }

  function seed(database: Database.Database) {
    const insertSession = database.prepare(
      "INSERT INTO conversation_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    insertSession.run(
      "same-z",
      "cli",
      "Newest Z",
      100,
      null,
      300,
      3,
      1,
      "model-safe",
      "default",
      "/Users/private/project",
      0,
      0,
      null,
    );
    insertSession.run(
      "same-a",
      "telegram",
      "Newest A",
      100,
      null,
      300,
      1,
      0,
      "model-safe",
      "default",
      null,
      0,
      0,
      null,
    );
    insertSession.run("older", "cli", null, 50, null, 200, 1, 0, null, null, null, 0, 0, null);
    insertSession.run(
      "cron-row",
      "cron",
      "Cron",
      100,
      null,
      500,
      1,
      0,
      null,
      null,
      null,
      0,
      0,
      null,
    );
    insertSession.run(
      "hidden-row",
      "cli",
      "Hidden",
      100,
      null,
      450,
      1,
      0,
      null,
      null,
      null,
      1,
      0,
      null,
    );
    insertSession.run(
      "archived-row",
      "cli",
      "Archived",
      100,
      null,
      400,
      1,
      0,
      null,
      null,
      null,
      0,
      1,
      null,
    );
    insertSession.run(
      "empty-row",
      "cli",
      "Empty",
      100,
      null,
      600,
      0,
      0,
      null,
      null,
      null,
      0,
      0,
      null,
    );

    const insertMessage = database.prepare(
      "INSERT INTO message_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    insertMessage.run(
      1,
      "same-z",
      "user",
      "Read /Users/private/work and token=secret-value",
      null,
      301,
      1,
      0,
      null,
      null,
      null,
      null,
    );
    insertMessage.run(
      2,
      "same-z",
      "tool",
      "raw tool output sk-proj-secret-value",
      "workspace",
      302,
      1,
      0,
      null,
      null,
      null,
      "private",
    );
    insertMessage.run(
      3,
      "same-z",
      "assistant",
      "Visible answer",
      null,
      303,
      1,
      0,
      null,
      "hidden reasoning",
      "raw api",
      null,
    );
    insertMessage.run(
      4,
      "same-z",
      "user",
      "Internal notice",
      null,
      304,
      1,
      0,
      "internal_notification",
      null,
      null,
      null,
    );
    insertMessage.run(
      5,
      "same-z",
      "assistant",
      "Compacted answer",
      null,
      305,
      0,
      1,
      null,
      null,
      null,
      null,
    );
    insertMessage.run(
      6,
      "same-a",
      "user",
      "Second conversation",
      null,
      303,
      1,
      0,
      null,
      null,
      null,
      null,
    );
    insertMessage.run(
      7,
      "older",
      "user",
      "Older conversation",
      null,
      201,
      1,
      0,
      null,
      null,
      null,
      null,
    );
  }

  it("paginates eligible sessions stably with opaque cursors", async () => {
    const { context, database } = fixture();
    seed(database);
    database.close();

    const first = await readConversationPage(
      context,
      manifest.conversation,
      null,
      2,
      new Date("2026-09-07T00:00:00Z"),
    );
    expect(conversationPageSchema.safeParse(first).success).toBe(true);
    expect(first.items.map((item) => item.title)).toEqual(["Newest Z", "Newest A"]);
    expect(first.nextCursor).toMatch(/^cursor-/u);
    expect(JSON.stringify(first)).not.toContain("same-z");
    expect(JSON.stringify(first)).not.toContain("cron-row");
    expect(JSON.stringify(first)).not.toContain("hidden-row");
    expect(JSON.stringify(first)).not.toContain("archived-row");
    expect(JSON.stringify(first)).not.toContain("Empty");
    expect(first.items.map((item) => item.lastActivity)).toEqual([
      "1970-01-01T00:05:03.000Z",
      "1970-01-01T00:05:03.000Z",
    ]);

    const second = await readConversationPage(context, manifest.conversation, first.nextCursor, 2);
    expect(second.items.map((item) => item.title)).toEqual(["Untitled conversation"]);
    expect(second.nextCursor).toBeNull();
  });

  it("returns only active visible text and bounded tool labels", async () => {
    const { context, database } = fixture();
    seed(database);
    database.close();
    const page = await readConversationPage(context, manifest.conversation, null, 1);
    const updated = new Database(
      path.join(context.home, manifest.conversation.databaseRelativePath),
    );
    updated
      .prepare(
        "UPDATE conversation_records SET last_seen = ?, finished_time = ? WHERE record_id = ?",
      )
      .run(null, 2_700_000, "same-z");
    updated.close();
    const transcript = await readConversationTranscript(
      context,
      manifest.conversation,
      page.items[0]!.id,
    );

    expect(conversationSchema.safeParse(transcript).success).toBe(true);
    expect(transcript.messages.map(({ role, content }) => [role, content])).toEqual([
      ["user", "Read <local-path> and [REDACTED]"],
      ["tool", "workspace activity"],
      ["assistant", "Visible answer"],
    ]);
    const serialized = JSON.stringify(transcript);
    expect(serialized).not.toContain("hidden reasoning");
    expect(serialized).not.toContain("raw api");
    expect(serialized).not.toContain("raw tool output");
    expect(serialized).not.toContain("Internal notice");
    expect(serialized).not.toContain("Compacted answer");
    expect(serialized).not.toContain("same-z");
    expect(transcript.truncated).toBeUndefined();
    expect(transcript.workspace).toBe("<local-path>");
    expect(transcript.lastActivity).toBe("1970-01-01T00:05:03.000Z");
  });

  it("bounds oversized messages and rejects forged identities", async () => {
    const { context, database } = fixture();
    const insertSession = database.prepare(
      "INSERT INTO conversation_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    insertSession.run("large", "cli", "Large", 100, null, 100, 1, 0, null, null, null, 0, 0, null);
    database
      .prepare("INSERT INTO message_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(1, "large", "user", "x".repeat(30_000), null, 100, 1, 0, null, null, null, null);
    database.close();

    const page = await readConversationPage(context, manifest.conversation);
    expect(page.items[0]?.preview).toHaveLength(160);
    const transcript = await readConversationTranscript(
      context,
      manifest.conversation,
      page.items[0]!.id,
    );
    expect(transcript.messages[0]?.content).toHaveLength(20_000);
    expect(transcript.truncated).toBe(true);
    await expect(
      readConversationPage(context, manifest.conversation, "cursor-forged", 5),
    ).rejects.toMatchObject({ code: "invalid_path" });
    await expect(
      readConversationTranscript(context, manifest.conversation, "conversation-forged"),
    ).rejects.toMatchObject({ code: "invalid_path" });
  });

  it("rejects a malformed cursor before opening the conversation database", async () => {
    const { context, database } = fixture();
    database.close();
    let databaseCalls = 0;

    await expect(
      readConversationPage(context, manifest.conversation, "cursor-forged", 5, new Date(), {
        databaseReader: async () => {
          databaseCalls += 1;
          throw new Error("database reader must not run");
        },
      }),
    ).rejects.toMatchObject({ code: "invalid_path" });
    expect(databaseCalls).toBe(0);
  });

  it("surfaces a bounded busy diagnostic", async () => {
    const { context, database } = fixture();
    database.close();
    const busy = Object.assign(new Error("private database detail"), { code: "SQLITE_BUSY" });
    let captured: unknown;
    try {
      await readConversationPage(context, manifest.conversation, null, 5, new Date(), {
        databaseReader: async () => {
          throw busy;
        },
      });
    } catch (error) {
      captured = error;
    }
    expect(
      toSafeDiagnostic(captured, "conversation-store", new Date("2026-09-07T00:00:00Z")),
    ).toEqual({
      sourceId: "conversation-store",
      code: "source_busy",
      message: "The local source is temporarily busy.",
      observedAt: "2026-09-07T00:00:00.000Z",
    });
  });
});
