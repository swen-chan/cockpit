import { z } from "zod";

import { isoTimestampSchema } from "@/contracts/agents";

const taskTokenSchema = z
  .string()
  .regex(/^task-[A-Za-z0-9_-]+$/u)
  .max(6_000);
const cursorTokenSchema = z
  .string()
  .regex(/^cursor-[A-Za-z0-9_-]+$/u)
  .max(6_000);
const keySchema = z
  .string()
  .regex(/^[a-z]+-[1-9][0-9]*$/u)
  .max(48);
const textSchema = (characters: number) =>
  z
    .string()
    .max(characters * 2)
    .refine((value) => Array.from(value).length <= characters);

export const claudeSessionSummarySchema = z
  .object({
    id: taskTokenSchema,
    title: textSchema(500).nullable(),
    preview: textSchema(1_000).nullable(),
    directoryName: textSchema(80).nullable(),
    gitBranch: textSchema(160).nullable(),
    updatedAt: isoTimestampSchema.nullable(),
    issue: z.enum(["too_large", "malformed", "unavailable"]).nullable(),
  })
  .strict();

export const claudeSessionPageSchema = z
  .object({
    items: z.array(claudeSessionSummarySchema).max(5),
    nextCursor: cursorTokenSchema.nullable(),
    observedAt: isoTimestampSchema,
    scope: z.literal("Configured Claude Code session directory"),
    limited: z.boolean(),
  })
  .strict();

export const claudeSessionDetailSchema = z
  .object({
    id: taskTokenSchema,
    title: textSchema(500).nullable(),
    directoryName: textSchema(80).nullable(),
    gitBranch: textSchema(160).nullable(),
    messages: z
      .array(
        z
          .object({
            key: keySchema,
            role: z.enum(["user", "assistant", "summary"]),
            content: textSchema(20_000)
              .refine((value) => value.length > 0)
              .nullable(),
            timestamp: isoTimestampSchema.nullable(),
          })
          .strict(),
      )
      .max(250),
    activities: z
      .array(
        z
          .object({
            key: keySchema,
            messageKey: keySchema.nullable(),
            category: z.enum(["Read", "Search", "Edit", "Command", "Delegation", "Other"]),
            state: z.enum(["result_recorded", "recorded_error", "no_result_recorded"]),
            label: textSchema(240),
            filePath: textSchema(1_024).nullable(),
            command: textSchema(120).nullable(),
            result: z
              .object({ text: textSchema(2_000), truncated: z.boolean() })
              .strict()
              .nullable(),
          })
          .strict(),
      )
      .max(300),
    observedAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema.nullable(),
    limited: z.boolean(),
    pendingWrite: z.boolean(),
  })
  .strict()
  .refine(
    (detail) =>
      new TextEncoder().encode(detail.messages.map((message) => message.content ?? "").join(""))
        .byteLength <=
      256 * 1_024,
    { message: "Conversation text exceeds the display limit." },
  )
  .refine(
    (detail) =>
      new TextEncoder().encode(
        detail.activities.map((activity) => activity.result?.text ?? "").join(""),
      ).byteLength <=
      64 * 1_024,
    { message: "Recorded tool text exceeds the display limit." },
  );

export type ClaudeSessionSummary = z.infer<typeof claudeSessionSummarySchema>;
export type ClaudeSessionPage = z.infer<typeof claudeSessionPageSchema>;
export type ClaudeSessionDetail = z.infer<typeof claudeSessionDetailSchema>;
