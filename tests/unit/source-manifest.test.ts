import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  HERMES_SOURCE_PRESET_ID,
  readPrivateSourceManifest,
  resolveSourceManifest,
} from "@/server/config/source-manifest";

function collectStringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStringValues);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(collectStringValues);
  }
  return [];
}

function validManifest(): Record<string, unknown> {
  return {
    configRelativePath: "settings.yaml",
    conversation: {
      databaseRelativePath: "conversation-store.sqlite",
      sessionTable: "conversation_records",
      promptTable: "snapshot_records",
      sessionColumns: {
        id: "record_id",
        source: "origin_kind",
        startedAt: "created_time",
        messageCount: "visible_count",
        hidden: "is_hidden",
        archived: "is_archived",
        promptHash: "snapshot_ref",
        embeddedPrompt: "legacy_body",
      },
      promptColumns: { hash: "fingerprint", prompt: "body" },
      messages: {
        table: "message_records",
        columns: {
          id: "message_id",
          sessionId: "conversation_ref",
          role: "speaker",
          content: "body",
          timestamp: "created_time",
          active: "is_active",
        },
      },
    },
    jobs: {
      definitionsRelativePath: "scheduler/definitions.fixture.json",
      executionsDatabaseRelativePath: "scheduler/history.fixture.sqlite",
      rootJobsField: "task_items",
      definitionFields: {
        id: "task_key",
        name: "display_name",
        schedule: "cadence_spec",
        scheduleDisplay: "cadence_label",
        createdAt: "added_time",
        enabled: "is_enabled",
        state: "lifecycle_state",
        lastRunAt: "previous_time",
        nextRunAt: "upcoming_time",
        lastStatus: "result_state",
        failureStreak: "consecutive_failures",
        deliver: "delivery_target",
        profile: "profile_alias",
        skill: "single_capability",
        skills: "capability_list",
        enabledToolsets: "toolset_list",
      },
      scheduleFields: {
        display: "label_text",
        expression: "cron_expression",
        value: "raw_value",
        runAt: "scheduled_time",
      },
      executionTable: "attempt_records",
      executionColumns: {
        id: "attempt_key",
        jobId: "task_ref",
        status: "attempt_state",
        claimedAt: "claimed_time",
        startedAt: "begin_time",
        finishedAt: "end_time",
      },
    },
  };
}

describe("private source manifest", () => {
  it("keeps the tracked public example synthetic and schema-valid", () => {
    const filename = path.resolve("cockpit.local.example.json");
    const manifest = readPrivateSourceManifest(filename);

    expect(manifest.configRelativePath).toBe("example/config.yaml");
    expect(manifest.conversation.databaseRelativePath).toBe("example/conversations.sqlite");
    expect(manifest.jobs?.definitionsRelativePath).toBe("example/jobs.json");
    expect(
      collectStringValues(manifest).every(
        (value) => value.startsWith("example/") || value.startsWith("example_"),
      ),
    ).toBe(true);
  });

  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function writeManifest(value: unknown): string {
    const root = mkdtempSync(path.join(tmpdir(), "cockpit-manifest-"));
    roots.push(root);
    const filename = path.join(root, "local.json");
    writeFileSync(filename, JSON.stringify(value), "utf8");
    return filename;
  }

  it("accepts a bounded manifest with validated relative paths and SQL identifiers", () => {
    const filename = writeManifest(validManifest());
    expect(readPrivateSourceManifest(filename)).toMatchObject({
      configRelativePath: "settings.yaml",
      conversation: { sessionTable: "conversation_records" },
      jobs: { rootJobsField: "task_items", executionTable: "attempt_records" },
    });
  });

  it("resolves the explicit Hermes compatibility preset without a private manifest", () => {
    const resolved = resolveSourceManifest({ COCKPIT_SOURCE_PRESET: HERMES_SOURCE_PRESET_ID });

    expect(resolved).toMatchObject({
      presetId: HERMES_SOURCE_PRESET_ID,
      manifest: {
        configRelativePath: "config.yaml",
        conversation: {
          databaseRelativePath: "state.db",
          sessionTable: "sessions",
          messages: { table: "messages" },
        },
        jobs: {
          definitionsRelativePath: "cron/jobs.json",
          executionsDatabaseRelativePath: "cron/executions.db",
          executionTable: "executions",
        },
      },
    });
  });

  it("requires exactly one source configuration and never falls back from an invalid choice", () => {
    const filename = writeManifest(validManifest());

    expect(() => resolveSourceManifest({})).toThrowError(
      expect.objectContaining({ code: "missing_source" }),
    );
    expect(() => resolveSourceManifest({ COCKPIT_SOURCE_PRESET: "unknown-layout" })).toThrowError(
      expect.objectContaining({ code: "unsupported_source_version" }),
    );
    expect(() =>
      resolveSourceManifest({
        COCKPIT_SOURCE_MANIFEST: filename,
        COCKPIT_SOURCE_PRESET: HERMES_SOURCE_PRESET_ID,
      }),
    ).toThrowError(expect.objectContaining({ code: "source_malformed" }));
    expect(() =>
      resolveSourceManifest({
        COCKPIT_SOURCE_MANIFEST: path.join(path.dirname(filename), "missing.json"),
      }),
    ).toThrowError(expect.objectContaining({ code: "missing_source" }));
  });

  it.each([
    ["absolute source path", { configRelativePath: "/private/settings.yaml" }],
    ["path traversal", { configRelativePath: "../settings.yaml" }],
    ["SQL syntax in identifier", { conversation: { sessionTable: "records; DROP TABLE x" } }],
    ["missing hidden filter mapping", { conversation: { sessionColumns: { hidden: undefined } } }],
    ["prompt table without columns", { conversation: { promptColumns: undefined } }],
    [
      "SQL syntax in message table",
      { conversation: { messages: { table: "messages; DROP TABLE x" } } },
    ],
    ["job path traversal", { jobs: { definitionsRelativePath: "../private.json" } }],
    ["SQL syntax in execution table", { jobs: { executionTable: "attempts; DROP TABLE x" } }],
  ])("rejects %s", (_label, override) => {
    const base = validManifest();
    const candidate = structuredClone(base) as Record<string, unknown>;
    if ("configRelativePath" in override)
      candidate.configRelativePath = override.configRelativePath;
    if ("conversation" in override) {
      const conversation = candidate.conversation as Record<string, unknown>;
      const conversationOverride = override.conversation as Record<string, unknown>;
      if ("sessionTable" in conversationOverride)
        conversation.sessionTable = conversationOverride.sessionTable;
      if ("promptColumns" in conversationOverride)
        conversation.promptColumns = conversationOverride.promptColumns;
      if ("messages" in conversationOverride) {
        const messages = conversation.messages as Record<string, unknown>;
        Object.assign(messages, conversationOverride.messages);
      }
      if ("sessionColumns" in conversationOverride) {
        const columns = conversation.sessionColumns as Record<string, unknown>;
        Object.assign(columns, conversationOverride.sessionColumns);
      }
    }
    if ("jobs" in override) {
      const jobs = candidate.jobs as Record<string, unknown>;
      Object.assign(jobs, override.jobs);
    }
    expect(() => readPrivateSourceManifest(writeManifest(candidate))).toThrowError(
      expect.objectContaining({ code: "source_malformed" }),
    );
  });

  it("rejects oversized manifests without returning their contents", () => {
    const filename = writeManifest({ padding: "x".repeat(33 * 1_024) });
    expect(() => readPrivateSourceManifest(filename)).toThrowError(
      expect.objectContaining({ code: "source_too_large" }),
    );
  });
});
