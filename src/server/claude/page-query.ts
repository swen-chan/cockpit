import "server-only";
import { notFound } from "next/navigation";
import { z } from "zod";
import { claudeProjectIdSchema } from "@/contracts/agents";
import type { ClaudePanelDescriptor } from "@/server/panels/registry";
import { resolveClaudeProject } from "@/server/claude/projects";
import { parseRelativePath } from "@/server/security/path-policy";

export type ClaudePageSearch = Record<string, string | string[] | undefined>;
const schema = z.object({
  project: claudeProjectIdSchema.optional(),
  session: z
    .string()
    .max(6000)
    .regex(/^task-[A-Za-z0-9_-]+$/u)
    .optional(),
  path: z.string().max(2048).optional(),
  from: z.string().max(32).optional(),
  message: z
    .string()
    .max(48)
    .regex(/^message-[1-9][0-9]*$/u)
    .optional(),
});
export function claudePageQuery(panel: ClaudePanelDescriptor, input: ClaudePageSearch = {}) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) notFound();
  try {
    const project = resolveClaudeProject(panel, parsed.data.project);
    if (parsed.data.path !== undefined) parseRelativePath(parsed.data.path);
    return {
      project,
      session: parsed.data.session,
      path: parsed.data.path,
      message: parsed.data.message,
    };
  } catch {
    notFound();
  }
}
