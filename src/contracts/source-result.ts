import { z } from "zod";

export const sourceStampSchema = z
  .object({
    id: z.string().min(1).max(100),
    label: z.string().min(1).max(120),
    path: z.string().min(1).max(500),
    observedAt: z.string().min(1).max(80),
    state: z.enum(["ready", "unavailable", "error"]),
    truncated: z.boolean().optional(),
  })
  .strict();

export const profileSummarySchema = z
  .object({
    profile: z.string().min(1).max(100),
    profileKind: z.enum(["default", "named", "custom", "unavailable"]),
    homeLabel: z.string().min(1).max(1_024),
    resolutionSource: z.enum([
      "explicit",
      "environment",
      "sticky",
      "platform-default",
      "unavailable",
    ]),
    configState: z.enum(["ready", "unavailable", "error"]),
    model: z.string().min(1).max(200).nullable(),
    provider: z.string().min(1).max(100).nullable(),
    modifiedAt: z.string().min(1).max(80).optional(),
  })
  .strict();

export const systemSourceSchema = z
  .object({
    id: z.string().min(1).max(100),
    title: z.string().min(1).max(120),
    category: z.string().min(1).max(120),
    summary: z.string().min(1).max(500),
    content: z.string().max(100_000),
    stamp: sourceStampSchema,
    metadata: z
      .array(
        z
          .object({
            label: z.string().min(1).max(120),
            value: z.string().min(1).max(1_024),
            mono: z.boolean().optional(),
          })
          .strict(),
      )
      .max(20),
    collection: z
      .object({
        kind: z.enum(["skills", "tools"]),
        items: z
          .array(
            z
              .object({
                id: z.string().min(1).max(100),
                name: z.string().min(1).max(100),
                description: z.string().min(1).max(500),
                category: z.string().min(1).max(100),
                status: z.enum(["enabled", "disabled", "available", "error"]),
                path: z.string().min(1).max(500).optional(),
                modifiedAt: z.string().min(1).max(80).optional(),
                previewable: z.boolean().optional(),
              })
              .strict(),
          )
          .max(1_000),
      })
      .strict()
      .optional(),
  })
  .strict();

export const systemSnapshotSchema = z
  .object({
    profile: profileSummarySchema,
    sources: z.array(systemSourceSchema).max(8),
  })
  .strict();

export const conversationSummarySchema = z
  .object({
    id: z.string().min(1).max(500),
    title: z.string().min(1).max(500),
    preview: z.string().max(1_000),
    source: z.string().min(1).max(100),
    lastActivity: z.string().min(1).max(80),
    model: z.string().min(1).max(200),
    messageCount: z.number().int().nonnegative(),
    toolCallCount: z.number().int().nonnegative(),
    profile: z.string().min(1).max(100),
    workspace: z.string().min(1).max(500),
  })
  .strict();

export const conversationSchema = conversationSummarySchema
  .extend({
    messages: z
      .array(
        z
          .object({
            id: z.string().min(1).max(200),
            role: z.enum(["user", "assistant", "tool"]),
            content: z.string().max(100_000),
            timestamp: z.string().min(1).max(80),
          })
          .strict(),
      )
      .max(1_000),
    truncated: z.boolean().optional(),
  })
  .strict();

export const conversationPageSchema = z
  .object({
    items: z.array(conversationSummarySchema).max(25),
    nextCursor: z.string().min(1).max(500).nullable(),
    observedAt: z.string().min(1).max(80),
  })
  .strict();

export const workspaceEntrySchema = z
  .object({
    id: z.string().min(1).max(1_024),
    name: z.string().min(1).max(500),
    path: z.string().min(1).max(1_024),
    entryType: z.enum(["directory", "file"]),
    kind: z.string().min(1).max(100),
    size: z.string().min(1).max(100),
    sizeBytes: z.number().int().nonnegative().nullable(),
    modifiedAt: z.string().min(1).max(80),
    previewState: z.enum(["available", "metadata-only", "unavailable"]),
  })
  .strict();

export const workspaceFileSchema = workspaceEntrySchema
  .extend({
    entryType: z.literal("file"),
    content: z.string().max(100_000).optional(),
    truncated: z.boolean().optional(),
  })
  .strict();

export const workspaceDirectorySchema = z
  .object({
    path: z.string().max(1_024),
    parentPath: z.string().max(1_024).nullable(),
    items: z.array(workspaceEntrySchema).max(500),
    observedAt: z.string().min(1).max(80),
    truncated: z.boolean(),
  })
  .strict();

export const jobExecutionSchema = z
  .object({
    id: z.string().min(1).max(200),
    status: z.enum(["success", "failed", "running", "unknown"]),
    startedAt: z.string().min(1).max(80),
    finishedAt: z.string().min(1).max(80).nullable(),
  })
  .strict();

export const hermesJobSchema = z
  .object({
    id: z.string().min(1).max(200),
    name: z.string().min(1).max(200),
    schedule: z.string().min(1).max(200),
    createdAt: z.string().min(1).max(80).nullable(),
    state: z.enum(["enabled", "paused", "completed", "running"]),
    lastRun: z.string().min(1).max(80).nullable(),
    nextRun: z.string().min(1).max(80).nullable(),
    lastStatus: z.enum(["success", "failed", "running", "unknown", "never"]),
    failureStreak: z.number().int().nonnegative().max(1_000_000),
    delivery: z.string().min(1).max(100),
    profile: z.string().min(1).max(100),
    toolsets: z.array(z.string().min(1).max(100)).max(100),
    recordedAttempts: z.number().int().nonnegative().max(1_000_000),
    executions: z.array(jobExecutionSchema).max(10),
  })
  .strict();

export const jobsSnapshotSchema = z
  .object({
    jobs: z.array(hermesJobSchema).max(250),
    observedAt: z.string().min(1).max(80),
    definitionsState: z.enum(["ready", "unavailable", "error"]),
    executionsState: z.enum(["ready", "unavailable", "error"]),
  })
  .strict();

const overviewSectionStatusSchema = z.object({
  state: z.enum(["ready", "unavailable", "error"]),
  observedAt: z.string().min(1).max(80),
  message: z.string().min(1).max(200).optional(),
});

export const overviewSnapshotSchema = z
  .object({
    observedAt: z.string().min(1).max(80),
    profile: overviewSectionStatusSchema
      .extend({
        profile: z.string().min(1).max(100),
        homeLabel: z.string().min(1).max(1_024),
        configState: z.enum(["ready", "unavailable", "error"]),
        model: z.string().min(1).max(200).nullable(),
        provider: z.string().min(1).max(100).nullable(),
        modifiedAt: z.string().min(1).max(80).optional(),
      })
      .strict(),
    conversations: overviewSectionStatusSchema
      .extend({
        items: z
          .array(
            z
              .object({
                id: z.string().min(1).max(500),
                title: z.string().min(1).max(500),
                preview: z.string().max(1_000),
                source: z.string().min(1).max(100),
                lastActivity: z.string().min(1).max(80),
              })
              .strict(),
          )
          .max(5),
        hasMore: z.boolean(),
      })
      .strict(),
    system: overviewSectionStatusSchema
      .extend({
        items: z
          .array(
            z
              .object({
                id: z.string().min(1).max(100),
                title: z.string().min(1).max(120),
                label: z.string().min(1).max(120),
                state: z.enum(["ready", "unavailable", "error"]),
                observedAt: z.string().min(1).max(80),
                freshnessLabel: z.string().min(1).max(40),
                freshnessAt: z.string().min(1).max(80),
              })
              .strict(),
          )
          .max(5),
      })
      .strict(),
    jobs: overviewSectionStatusSchema
      .extend({
        total: z.number().int().nonnegative().max(250).nullable(),
        enabled: z.number().int().nonnegative().max(250).nullable(),
        paused: z.number().int().nonnegative().max(250).nullable(),
        failedLastRun: z.number().int().nonnegative().max(250).nullable(),
        executionsState: z.enum(["ready", "unavailable", "error"]),
        nextEvent: z
          .object({
            name: z.string().min(1).max(200),
            nextRun: z.string().min(1).max(80),
          })
          .strict()
          .nullable(),
      })
      .strict(),
    workspace: overviewSectionStatusSchema
      .extend({
        loadedCount: z.number().int().nonnegative().max(500).nullable(),
        truncated: z.boolean(),
        items: z
          .array(
            z
              .object({
                name: z.string().min(1).max(500),
                kind: z.string().min(1).max(100),
                size: z.string().min(1).max(100),
                modifiedAt: z.string().min(1).max(80),
              })
              .strict(),
          )
          .max(4),
      })
      .strict(),
  })
  .strict();
