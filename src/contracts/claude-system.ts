import { z } from "zod";

import { isoTimestampSchema } from "@/contracts/agents";

export const claudeSystemCategorySchema = z.enum(["Instructions", "Memory", "Skills", "Subagents"]);

export const claudeSystemSourceSchema = z
  .object({
    key: z.string().regex(/^source-[1-9][0-9]*$/u),
    category: claudeSystemCategorySchema,
    scope: z.enum(["Project", "User"]),
    relativePath: z.string().min(1).max(1_024),
    state: z.enum(["ready", "unavailable"]),
    content: z.string().max(40_000).nullable(),
    truncated: z.boolean(),
  })
  .strict();

export const claudeSystemSnapshotSchema = z
  .object({
    sources: z.array(claudeSystemSourceSchema).max(100),
    observedAt: isoTimestampSchema,
    limited: z.boolean(),
    unavailableScopes: z.array(z.enum(["Project", "User", "Memory"])).max(3),
  })
  .strict()
  .refine(
    (snapshot) =>
      new TextEncoder().encode(snapshot.sources.map((source) => source.content ?? "").join(""))
        .byteLength <=
      256 * 1_024,
    { message: "System text exceeds the display limit." },
  );

export type ClaudeSystemSource = z.infer<typeof claudeSystemSourceSchema>;
export type ClaudeSystemSnapshot = z.infer<typeof claudeSystemSnapshotSchema>;
