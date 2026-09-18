import { describe, expect, it } from "vitest";

import {
  codexOverviewSnapshotSchema,
  codexSystemSnapshotSchema,
  codexTaskDetailSchema,
  codexTaskPageSchema,
  codexTaskSummarySchema,
  safeCodexTurnSchema,
  safeProcessRowSchema,
  safeProcessTimelineSchema,
} from "@/contracts/codex";

const observedAt = "2026-09-16T00:00:00.000Z";
const summary = {
  id: "task-Abc_123",
  title: "Inspect the reader",
  preview: "A bounded safe preview.",
  source: "CLI",
  lastActivity: observedAt,
  status: "idle",
  projectLabel: "cockpit",
} as const;

describe("Codex-only browser contracts", () => {
  it("accepts bounded task summaries/pages and rejects raw persistence fields", () => {
    expect(codexTaskSummarySchema.safeParse(summary).success).toBe(true);
    expect(
      codexTaskPageSchema.safeParse({
        items: [summary],
        nextCursor: "cursor-Abc_456",
        observedAt,
        indexScope: "Codex state database",
        inventoryNote: "State-database index; some local tasks may be absent.",
      }).success,
    ).toBe(true);

    for (const candidate of [
      { ...summary, id: "55555555-5555-4555-8555-555555555555" },
      { ...summary, cwd: "/Users/private/work" },
      { ...summary, threadId: "raw-thread" },
      { ...summary, rolloutPath: "/private/state.jsonl" },
      { ...summary, projectLabel: "/Users/private/work" },
      { ...summary, projectLabel: "private/work" },
      { ...summary, projectLabel: "credentials.json" },
      { ...summary, projectLabel: "token=supersecret" },
      { ...summary, projectLabel: "github_pat_1234567890abcdef" },
      { ...summary, projectLabel: "AKIAIOSFODNN7EXAMPLE" },
      { ...summary, projectLabel: "id_rsa" },
      { ...summary, projectLabel: "id_ed25519" },
      { ...summary, projectLabel: "server.pem.bak" },
      { ...summary, projectLabel: `safe\u202Ehidden` },
      { ...summary, lastActivity: "not-a-time" },
    ]) {
      expect(codexTaskSummarySchema.safeParse(candidate).success).toBe(false);
    }
    expect(
      codexTaskPageSchema.safeParse({
        items: [summary],
        nextCursor: null,
        observedAt: "/Users/private/.codex",
        indexScope: "Codex state database",
        inventoryNote: "State-database index; some local tasks may be absent.",
      }).success,
    ).toBe(false);
  });

  it("keeps Codex System path-free and runtime-version-specific", () => {
    const snapshot = {
      runtime: { label: "Codex CLI", state: "ready", version: "0.145.0" },
      sources: [
        {
          key: "workspace-guidance",
          label: "Workspace guidance",
          origin: "Approved workspace",
          state: "ready",
          content: "Current bounded guidance.",
          truncated: false,
        },
      ],
      observedAt,
    } as const;
    expect(codexSystemSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(
      codexSystemSnapshotSchema.safeParse({ ...snapshot, codexHome: "/Users/private/.codex" })
        .success,
    ).toBe(false);
    expect(
      codexSystemSnapshotSchema.safeParse({
        ...snapshot,
        sources: [{ ...snapshot.sources[0], filename: "private/SOUL.md" }],
      }).success,
    ).toBe(false);
    expect(
      codexSystemSnapshotSchema.safeParse({
        ...snapshot,
        runtime: { label: "Codex CLI", state: "ready", version: "0.146.0" },
      }).success,
    ).toBe(false);
    expect(
      codexSystemSnapshotSchema.safeParse({
        ...snapshot,
        runtime: { label: "Codex CLI", state: "error", message: "Failed at /Users/private/.codex" },
      }).success,
    ).toBe(false);
    expect(
      codexSystemSnapshotSchema.safeParse({
        ...snapshot,
        sources: [
          {
            key: "global-guidance",
            label: "Global guidance",
            state: "missing",
            message: "Missing /Users/private/.codex/AGENTS.md",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      codexSystemSnapshotSchema.safeParse({
        ...snapshot,
        sources: [
          {
            key: "global-guidance",
            label: "Global guidance",
            state: "missing",
            message: "No current guidance was observed.",
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      codexSystemSnapshotSchema.safeParse({
        ...snapshot,
        sources: [{ ...snapshot.sources[0], content: "" }],
      }).success,
    ).toBe(false);
    expect(
      codexSystemSnapshotSchema.safeParse({
        ...snapshot,
        sources: [snapshot.sources[0], snapshot.sources[0]],
      }).success,
    ).toBe(false);
  });

  it("accepts the explicit safe Process union without generic raw payloads", () => {
    const detail = {
      summary,
      turns: [
        {
          key: "turn-1",
          status: "completed",
          messages: [
            { key: "message-1", role: "user", content: "Check the bounded reader." },
            { key: "message-2", role: "assistant", content: "The safe result is ready." },
          ],
          process: {
            count: 7,
            rows: [
              { type: "progress", key: "process-1", text: "Inspecting synthetic input." },
              { type: "reasoning_summary", key: "process-2", text: "Validated the boundary." },
              { type: "plan", key: "process-3", text: "Run the focused check." },
              {
                type: "command",
                key: "process-4",
                label: "Command",
                preview: "List workspace files",
                status: "completed",
                exitCode: 0,
                output: { text: "src/index.ts", truncated: false },
              },
              {
                type: "tool",
                key: "process-5",
                label: "Viewed image",
                status: "completed",
                fields: [{ label: "File", value: "docs/preview.png" }],
              },
              {
                type: "changes",
                key: "process-6",
                status: "completed",
                files: [{ path: "src/index.ts", change: "modify" }],
                patch: { text: "+safe", truncated: false },
              },
              {
                type: "hidden",
                key: "process-7",
                label: "Details hidden",
                itemType: "Tool",
                count: 2,
              },
            ],
            omitted: [],
          },
          omitted: [],
        },
      ],
      observedAt,
      omitted: [],
    } as const;

    expect(codexTaskDetailSchema.safeParse(detail).success).toBe(true);
    expect(
      codexTaskDetailSchema.safeParse({
        ...detail,
        turns: [
          {
            ...detail.turns[0],
            process: { ...detail.turns[0].process, count: 6 },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      codexTaskDetailSchema.safeParse({
        ...detail,
        turns: [
          {
            ...detail.turns[0],
            process: {
              ...detail.turns[0].process,
              rows: [
                {
                  type: "reasoning_summary",
                  key: "process-1",
                  text: "safe",
                  content: "raw chain of thought",
                },
              ],
              count: 1,
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      codexTaskDetailSchema.safeParse({
        ...detail,
        turns: [
          {
            ...detail.turns[0],
            process: {
              ...detail.turns[0].process,
              rows: [
                {
                  type: "command",
                  key: "process-1",
                  label: "Command",
                  status: "completed",
                  command: "secret --token=x",
                },
              ],
              count: 1,
            },
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      safeProcessRowSchema.safeParse({
        type: "tool",
        key: "process-1",
        label: "Viewed image",
        fields: [{ label: "File", value: "docs/preview.png" }],
      }).success,
    ).toBe(true);
    for (const row of [
      { type: "tool", key: "process-1", label: "Viewed image", fields: [] },
      {
        type: "tool",
        key: "process-1",
        label: "Viewed image",
        fields: [{ label: "File", value: "/private/image.png" }],
      },
      {
        type: "tool",
        key: "process-1",
        label: "Viewed image",
        fields: [{ label: "File", value: "../image.png" }],
      },
      {
        type: "tool",
        key: "process-1",
        label: "Viewed image",
        fields: [{ label: "File", value: ".env" }],
      },
      {
        type: "tool",
        key: "process-1",
        label: "Viewed image",
        fields: [{ label: "File", value: "docs/token=supersecret" }],
      },
      {
        type: "tool",
        key: "process-1",
        label: "Viewed image",
        fields: [{ label: "File", value: "docs/server.pem.bak" }],
      },
      {
        type: "tool",
        key: "process-1",
        label: "Web search",
        fields: [{ label: "File", value: "docs/query.txt" }],
      },
      {
        type: "tool",
        key: "process-1",
        label: "Tool",
        fields: [{ label: "File", value: "docs/value.txt" }],
      },
    ]) {
      expect(safeProcessRowSchema.safeParse(row).success).toBe(false);
    }
    expect(
      safeProcessRowSchema.safeParse({
        type: "tool",
        key: "process-1",
        label: "Web search",
        fields: [],
      }).success,
    ).toBe(true);

    expect(
      safeProcessRowSchema.safeParse({
        type: "command",
        key: "process-1",
        label: "Command",
        status: "completed",
        output: { text: Array.from({ length: 121 }, () => "line").join("\n"), truncated: true },
      }).success,
    ).toBe(false);
    expect(
      safeProcessRowSchema.safeParse({
        type: "command",
        key: "process-1",
        label: "Command",
        status: "completed",
        output: { text: Array.from({ length: 120 }, () => "line").join("\n"), truncated: false },
      }).success,
    ).toBe(true);
    expect(
      safeProcessRowSchema.safeParse({
        type: "changes",
        key: "process-1",
        status: "completed",
        files: [{ path: "src/index.ts", change: "modify" }],
        patch: { text: Array.from({ length: 301 }, () => "+line").join("\n"), truncated: true },
      }).success,
    ).toBe(false);
    expect(
      safeProcessRowSchema.safeParse({
        type: "changes",
        key: "process-1",
        status: "completed",
        files: [{ path: "src/index.ts", change: "modify" }],
        patch: { text: Array.from({ length: 300 }, () => "+line").join("\n"), truncated: false },
      }).success,
    ).toBe(true);

    const truncatedTimeline = {
      count: 1,
      rows: [
        {
          type: "command",
          key: "process-1",
          label: "Command",
          status: "completed",
          output: { text: "safe excerpt", truncated: true },
        },
      ],
      omitted: [],
    } as const;
    expect(safeProcessTimelineSchema.safeParse(truncatedTimeline).success).toBe(false);
    expect(
      safeProcessTimelineSchema.safeParse({
        ...truncatedTimeline,
        omitted: [{ reason: "limit", label: "Content omitted by limit" }],
      }).success,
    ).toBe(true);

    const inProgressTurn = {
      key: "turn-1",
      status: "in-progress",
      messages: [{ key: "message-1", role: "status", content: "Still in progress; refresh later" }],
      process: null,
      omitted: [],
    } as const;
    expect(safeCodexTurnSchema.safeParse(inProgressTurn).success).toBe(true);
    expect(
      safeCodexTurnSchema.safeParse({
        ...inProgressTurn,
        process: { count: 0, rows: [], omitted: [] },
      }).success,
    ).toBe(false);

    expect(
      codexTaskDetailSchema.safeParse({
        ...detail,
        turns: [
          {
            ...detail.turns[0],
            messages: Array.from({ length: 14 }, (_, index) => ({
              key: `message-${index + 1}`,
              role: "assistant" as const,
              content: "m".repeat(20_000),
            })),
            process: null,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      codexTaskDetailSchema.safeParse({
        ...detail,
        turns: [
          {
            ...detail.turns[0],
            messages: [],
            process: {
              count: 17,
              rows: Array.from({ length: 17 }, (_, index) => ({
                type: "progress" as const,
                key: `process-${index + 1}`,
                text: "p".repeat(4_000),
              })),
              omitted: [],
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("defines a strict Codex Overview without Jobs or raw configuration", () => {
    const overview = {
      panelName: "Codex",
      observedAt,
      runtime: { state: "ready", observedAt, label: "Codex CLI", version: "0.145.0" },
      tasks: { state: "ready", observedAt, items: [summary], hasMore: false },
      guidance: {
        state: "ready",
        observedAt,
        items: [{ label: "Global guidance", state: "missing" }],
      },
      workspace: { state: "unsupported", observedAt, message: "Files not configured" },
    } as const;
    expect(codexOverviewSnapshotSchema.safeParse(overview).success).toBe(true);
    expect(codexOverviewSnapshotSchema.safeParse({ ...overview, jobs: { total: 0 } }).success).toBe(
      false,
    );
    expect(
      codexOverviewSnapshotSchema.safeParse({ ...overview, rawConfig: { model: "private" } })
        .success,
    ).toBe(false);
    expect(
      codexOverviewSnapshotSchema.safeParse({
        ...overview,
        tasks: { state: "error", observedAt, message: "Failed at /Users/private/.codex" },
      }).success,
    ).toBe(false);
    expect(
      codexOverviewSnapshotSchema.safeParse({
        ...overview,
        guidance: {
          state: "ready",
          observedAt,
          items: [
            { label: "Global guidance", state: "ready" },
            { label: "Global guidance", state: "missing" },
          ],
        },
      }).success,
    ).toBe(false);
  });
});
