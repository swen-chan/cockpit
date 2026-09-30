import { z } from "zod";
import { isoTimestampSchema, publicClaudeProjectSchema } from "@/contracts/agents";
import { claudeSessionPageSchema } from "@/contracts/claude";
export const claudeOverviewSnapshotSchema = z
  .object({
    project: publicClaudeProjectSchema,
    sessions: claudeSessionPageSchema.nullable(),
    system: z
      .object({
        counts: z
          .object({
            Instructions: z.number().int().nonnegative(),
            Memory: z.number().int().nonnegative(),
            Skills: z.number().int().nonnegative(),
            Subagents: z.number().int().nonnegative(),
          })
          .strict(),
        limited: z.boolean(),
        unavailable: z.boolean(),
      })
      .strict()
      .nullable(),
    files: z
      .object({ entries: z.number().int().nonnegative(), limited: z.boolean() })
      .strict()
      .nullable(),
    observedAt: isoTimestampSchema,
  })
  .strict();
export type ClaudeOverviewSnapshot = z.infer<typeof claudeOverviewSnapshotSchema>;
