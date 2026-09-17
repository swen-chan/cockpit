import { z } from "zod";

import { isoTimestampSchema, safePublicMessageSchema } from "@/contracts/agents";
import { isCredentialFilename } from "@/lib/browser-safety";

const utf8 = new TextEncoder();
const ordinalKeySchema = z
  .string()
  .regex(/^[a-z]+-[1-9][0-9]*$/u)
  .max(48);
const taskTokenSchema = z
  .string()
  .regex(/^task-[A-Za-z0-9_-]+$/u)
  .max(6_000);
const cursorTokenSchema = z
  .string()
  .regex(/^cursor-[A-Za-z0-9_-]+$/u)
  .max(6_000);
const terminalStatusSchema = z.enum(["completed", "failed", "declined"]);
const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

function boundedText(maxCharacters: number, maxBytes: number, minimumCharacters = 0) {
  return z
    .string()
    .min(minimumCharacters)
    .max(maxBytes)
    .refine(
      (value) =>
        Array.from(value).length <= maxCharacters && utf8.encode(value).byteLength <= maxBytes,
    );
}

function isSafeRelativePath(value: string): boolean {
  return (
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !CONTROL_OR_BIDI.test(value) &&
    !value
      .split("/")
      .some((segment) => !segment || segment.startsWith(".") || isCredentialFilename(segment))
  );
}

function lineCount(value: string): number {
  return value.length === 0 ? 0 : value.split(/\r\n|\r|\n/u).length;
}

const projectLabelSchema = boundedText(80, 256, 1).refine(
  (value) =>
    value !== "." &&
    value !== ".." &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !CONTROL_OR_BIDI.test(value) &&
    !isCredentialFilename(value),
);

export const codexTaskSummarySchema = z
  .object({
    id: taskTokenSchema,
    title: boundedText(500, 2_000, 1).nullable(),
    preview: boundedText(1_000, 4_000, 1).nullable(),
    source: z.enum(["CLI", "VS Code", "App Server"]),
    lastActivity: isoTimestampSchema.nullable(),
    status: z.enum(["idle", "active", "error", "unknown"]),
    projectLabel: projectLabelSchema.nullable(),
  })
  .strict();

export const codexTaskPageSchema = z
  .object({
    items: z.array(codexTaskSummarySchema).max(5),
    nextCursor: cursorTokenSchema.nullable(),
    observedAt: isoTimestampSchema,
    indexScope: z.literal("Codex state database"),
    inventoryNote: z.literal("State-database index; some local tasks may be absent."),
  })
  .strict();

export const omittedContentSchema = z
  .object({
    reason: z.enum(["limit", "policy", "unsupported"]),
    label: z.enum([
      "Content omitted by limit",
      "Details hidden by policy",
      "Unsupported activity omitted",
    ]),
    count: z.number().int().positive().max(1_000_000).optional(),
  })
  .strict()
  .superRefine((omitted, context) => {
    const expected =
      omitted.reason === "limit"
        ? "Content omitted by limit"
        : omitted.reason === "policy"
          ? "Details hidden by policy"
          : "Unsupported activity omitted";
    if (omitted.label !== expected)
      context.addIssue({ code: "custom", message: "Omission label does not match its reason." });
  });

export const safeCodexMessageSchema = z
  .object({
    key: ordinalKeySchema,
    role: z.enum(["user", "assistant", "status"]),
    content: boundedText(20_000, 64 * 1_024, 1),
  })
  .strict();

const processTextSchema = boundedText(4_000, 16 * 1_024, 1);
const processBaseSchema = z.object({ key: ordinalKeySchema });
const safeOutputSchema = z
  .object({
    text: boundedText(8_192, 8 * 1_024),
    truncated: z.boolean(),
  })
  .strict()
  .refine((output) => lineCount(output.text) <= 120, {
    message: "Command output line limit exceeded.",
  });
const safePatchSchema = z
  .object({
    text: boundedText(24_576, 24 * 1_024),
    truncated: z.boolean(),
  })
  .strict()
  .refine((patch) => lineCount(patch.text) <= 300, {
    message: "Patch line limit exceeded.",
  });
const safeRelativePathSchema = z.string().min(1).max(1_024).refine(isSafeRelativePath);
const safeToolPathSchema = boundedText(240, 960, 1).refine(isSafeRelativePath);

const progressRowSchema = processBaseSchema
  .extend({
    type: z.literal("progress"),
    text: processTextSchema,
  })
  .strict();
const reasoningRowSchema = processBaseSchema
  .extend({
    type: z.literal("reasoning_summary"),
    text: processTextSchema,
  })
  .strict();
const planRowSchema = processBaseSchema
  .extend({
    type: z.literal("plan"),
    text: processTextSchema,
  })
  .strict();
const commandRowSchema = processBaseSchema
  .extend({
    type: z.literal("command"),
    label: z.literal("Command"),
    preview: boundedText(1_024, 4_096, 1).optional(),
    status: terminalStatusSchema,
    durationMs: z.number().int().nonnegative().optional(),
    exitCode: z.number().int().min(-2_147_483_648).max(2_147_483_647).optional(),
    output: safeOutputSchema.optional(),
  })
  .strict();
const toolRowSchema = processBaseSchema
  .extend({
    type: z.literal("tool"),
    label: z.enum(["Viewed image", "Web search", "Tool"]),
    status: terminalStatusSchema.optional(),
    durationMs: z.number().int().nonnegative().optional(),
    fields: z
      .array(
        z
          .object({
            label: z.literal("File"),
            value: safeToolPathSchema,
          })
          .strict(),
      )
      .max(1),
  })
  .strict()
  .superRefine((row, context) => {
    if (
      (row.label === "Viewed image" && row.fields.length !== 1) ||
      (row.label !== "Viewed image" && row.fields.length !== 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Tool fields do not match the safe tool policy.",
      });
    }
  });
const changesRowSchema = processBaseSchema
  .extend({
    type: z.literal("changes"),
    status: terminalStatusSchema,
    files: z
      .array(
        z
          .object({
            path: safeRelativePathSchema,
            change: z.enum(["add", "modify", "delete"]),
          })
          .strict(),
      )
      .max(50),
    patch: safePatchSchema.optional(),
  })
  .strict();
const hiddenRowSchema = processBaseSchema
  .extend({
    type: z.literal("hidden"),
    label: z.enum(["Details hidden", "Unsupported activity"]),
    itemType: z.enum(["Command", "Tool", "Changes", "Activity"]),
    status: terminalStatusSchema.optional(),
    count: z.number().int().positive().max(1_000_000),
  })
  .strict();

export const safeProcessRowSchema = z.discriminatedUnion("type", [
  progressRowSchema,
  reasoningRowSchema,
  planRowSchema,
  commandRowSchema,
  toolRowSchema,
  changesRowSchema,
  hiddenRowSchema,
]);

export const safeProcessTimelineSchema = z
  .object({
    count: z.number().int().nonnegative().max(40),
    rows: z.array(safeProcessRowSchema).max(40),
    omitted: z.array(omittedContentSchema).max(20),
  })
  .strict()
  .superRefine((timeline, context) => {
    if (timeline.count !== timeline.rows.length) {
      context.addIssue({ code: "custom", message: "Process count must match its visible rows." });
    }
    const hasTruncatedDetail = timeline.rows.some(
      (row) =>
        (row.type === "command" && row.output?.truncated) ||
        (row.type === "changes" && row.patch?.truncated),
    );
    if (hasTruncatedDetail && !timeline.omitted.some((omitted) => omitted.reason === "limit")) {
      context.addIssue({
        code: "custom",
        message: "Truncated Process details require a limit omission.",
      });
    }
  });

export const safeCodexTurnSchema = z
  .object({
    key: ordinalKeySchema,
    status: z.enum(["completed", "interrupted", "failed", "in-progress"]),
    messages: z.array(safeCodexMessageSchema).max(250),
    process: safeProcessTimelineSchema.nullable(),
    omitted: z.array(omittedContentSchema).max(20),
  })
  .strict()
  .superRefine((turn, context) => {
    if (turn.status === "in-progress" && turn.process !== null) {
      context.addIssue({
        code: "custom",
        message: "In-progress turns cannot expose Process details.",
      });
    }
  });

export const codexTaskDetailSchema = z
  .object({
    summary: codexTaskSummarySchema,
    turns: z.array(safeCodexTurnSchema).max(100),
    observedAt: isoTimestampSchema,
    omitted: z.array(omittedContentSchema).max(20),
  })
  .strict()
  .superRefine((detail, context) => {
    const messageCount = detail.turns.reduce((total, turn) => total + turn.messages.length, 0);
    const processCount = detail.turns.reduce(
      (total, turn) => total + (turn.process?.rows.length ?? 0),
      0,
    );
    const transcriptBytes = detail.turns.reduce(
      (total, turn) =>
        total +
        turn.messages.reduce(
          (turnTotal, message) => turnTotal + utf8.encode(message.content).byteLength,
          0,
        ),
      0,
    );
    const processBytes = detail.turns.reduce(
      (total, turn) =>
        total +
        (turn.process?.rows.reduce((rowTotal, row) => {
          const values =
            row.type === "progress" || row.type === "reasoning_summary" || row.type === "plan"
              ? [row.text]
              : row.type === "command"
                ? [row.preview, row.output?.text]
                : row.type === "tool"
                  ? row.fields.map((field) => field.value)
                  : row.type === "changes"
                    ? [...row.files.map((file) => file.path), row.patch?.text]
                    : [];
          return (
            rowTotal +
            values.reduce(
              (valueTotal, value) =>
                valueTotal + (value === undefined ? 0 : utf8.encode(value).byteLength),
              0,
            )
          );
        }, 0) ?? 0),
      0,
    );
    if (messageCount > 250)
      context.addIssue({ code: "custom", message: "Task message limit exceeded." });
    if (transcriptBytes > 256 * 1_024)
      context.addIssue({ code: "custom", message: "Task transcript limit exceeded." });
    if (processCount > 300)
      context.addIssue({ code: "custom", message: "Task Process limit exceeded." });
    if (processBytes > 64 * 1_024)
      context.addIssue({ code: "custom", message: "Task Process text limit exceeded." });
    if (utf8.encode(JSON.stringify(detail)).byteLength > 512 * 1_024) {
      context.addIssue({ code: "custom", message: "Serialized task limit exceeded." });
    }
  });

const guidanceKeySchema = z.enum(["global-guidance", "workspace-guidance", "custom-guidance"]);
const guidanceLabelSchema = z.enum(["Global guidance", "Workspace guidance", "Custom guidance"]);
const guidanceIdentity = {
  "global-guidance": { label: "Global guidance", origin: "Codex home" },
  "workspace-guidance": { label: "Workspace guidance", origin: "Approved workspace" },
  "custom-guidance": { label: "Custom guidance", origin: "Configured workspace file" },
} as const;
const guidanceReadySchema = z
  .object({
    key: guidanceKeySchema,
    label: guidanceLabelSchema,
    origin: z.enum(["Codex home", "Approved workspace", "Configured workspace file"]),
    state: z.literal("ready"),
    content: boundedText(100_000, 256 * 1_024, 1),
    truncated: z.boolean(),
  })
  .strict();
const guidanceFailureBase = {
  key: guidanceKeySchema,
  label: guidanceLabelSchema,
};
const guidanceMissingSchema = z
  .object({
    ...guidanceFailureBase,
    state: z.literal("missing"),
    message: z.literal("No current guidance was observed."),
  })
  .strict();
const guidanceUnavailableSchema = z
  .object({
    ...guidanceFailureBase,
    state: z.literal("unavailable"),
    message: z.literal("Current guidance is unavailable."),
  })
  .strict();
const guidanceErrorSchema = z
  .object({
    ...guidanceFailureBase,
    state: z.literal("error"),
    message: z.literal("Current guidance could not be read safely."),
  })
  .strict();

export const codexGuidanceSourceSchema = z
  .discriminatedUnion("state", [
    guidanceReadySchema,
    guidanceMissingSchema,
    guidanceUnavailableSchema,
    guidanceErrorSchema,
  ])
  .superRefine((source, context) => {
    const expected = guidanceIdentity[source.key];
    if (
      source.label !== expected.label ||
      (source.state === "ready" && source.origin !== expected.origin)
    ) {
      context.addIssue({ code: "custom", message: "Guidance identity is inconsistent." });
    }
  });

const runtimeReadySchema = z
  .object({
    label: z.literal("Codex CLI"),
    state: z.literal("ready"),
    version: z.literal("0.145.0"),
  })
  .strict();
const runtimeFailureSchema = z
  .object({
    label: z.literal("Codex CLI"),
    state: z.enum(["unavailable", "error"]),
    message: safePublicMessageSchema,
  })
  .strict();

export const codexSystemSnapshotSchema = z
  .object({
    runtime: z.discriminatedUnion("state", [runtimeReadySchema, runtimeFailureSchema]),
    sources: z.array(codexGuidanceSourceSchema).max(3),
    observedAt: isoTimestampSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    const keys = snapshot.sources.map((source) => source.key);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: "custom", message: "Guidance sources must be unique." });
    }
  });

const overviewFailureSchema = z
  .object({
    state: z.enum(["unavailable", "error"]),
    observedAt: isoTimestampSchema,
    message: safePublicMessageSchema,
  })
  .strict();
const overviewRuntimeReadySchema = z
  .object({
    state: z.literal("ready"),
    observedAt: isoTimestampSchema,
    label: z.literal("Codex CLI"),
    version: z.literal("0.145.0"),
  })
  .strict();
const overviewTasksReadySchema = z
  .object({
    state: z.literal("ready"),
    observedAt: isoTimestampSchema,
    items: z.array(codexTaskSummarySchema).max(5),
    hasMore: z.boolean(),
  })
  .strict();
const overviewGuidanceReadySchema = z
  .object({
    state: z.literal("ready"),
    observedAt: isoTimestampSchema,
    items: z
      .array(
        z
          .object({
            label: guidanceLabelSchema,
            state: z.enum(["ready", "missing", "unavailable", "error"]),
          })
          .strict(),
      )
      .max(3),
  })
  .strict()
  .superRefine((guidance, context) => {
    const labels = guidance.items.map((item) => item.label);
    if (new Set(labels).size !== labels.length) {
      context.addIssue({ code: "custom", message: "Guidance summaries must be unique." });
    }
  });
const overviewWorkspaceUnsupportedSchema = z
  .object({
    state: z.literal("unsupported"),
    observedAt: isoTimestampSchema,
    message: z.literal("Files not configured"),
  })
  .strict();
const overviewWorkspaceReadySchema = z
  .object({
    state: z.literal("ready"),
    observedAt: isoTimestampSchema,
    loadedCount: z.number().int().nonnegative().max(500),
    truncated: z.boolean(),
    items: z
      .array(
        z
          .object({
            name: z.string().min(1).max(500),
            kind: z.string().min(1).max(100),
            size: z.string().min(1).max(100),
            modifiedAt: isoTimestampSchema,
          })
          .strict(),
      )
      .max(4),
  })
  .strict();

export const codexOverviewSnapshotSchema = z
  .object({
    panelName: z.literal("Codex"),
    observedAt: isoTimestampSchema,
    runtime: z.union([overviewRuntimeReadySchema, overviewFailureSchema]),
    tasks: z.union([overviewTasksReadySchema, overviewFailureSchema]),
    guidance: z.union([overviewGuidanceReadySchema, overviewFailureSchema]),
    workspace: z.union([
      overviewWorkspaceUnsupportedSchema,
      overviewWorkspaceReadySchema,
      overviewFailureSchema,
    ]),
  })
  .strict();

export type CodexTaskSummary = z.infer<typeof codexTaskSummarySchema>;
export type CodexTaskPage = z.infer<typeof codexTaskPageSchema>;
export type CodexTaskDetail = z.infer<typeof codexTaskDetailSchema>;
export type SafeCodexTurn = z.infer<typeof safeCodexTurnSchema>;
export type SafeCodexMessage = z.infer<typeof safeCodexMessageSchema>;
export type SafeProcessTimeline = z.infer<typeof safeProcessTimelineSchema>;
export type SafeProcessRow = z.infer<typeof safeProcessRowSchema>;
export type OmittedContent = z.infer<typeof omittedContentSchema>;
export type CodexSystemSnapshot = z.infer<typeof codexSystemSnapshotSchema>;
export type CodexOverviewSnapshot = z.infer<typeof codexOverviewSnapshotSchema>;
