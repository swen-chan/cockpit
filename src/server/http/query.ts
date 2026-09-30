import "server-only";

import { z } from "zod";
import { claudeProjectIdSchema } from "@/contracts/agents";

import { SourceSecurityError } from "@/server/security/errors";
import { SOURCE_LIMITS } from "@/server/security/limits";
import { parseRelativePath } from "@/server/security/path-policy";

const maxQueryParameters = 4;
const maxQueryKeyCharacters = 32;
const scopedTaskId = /^task-[A-Za-z0-9_-]+$/u;
const scopedCursor = /^cursor-[A-Za-z0-9_-]+$/u;
const opaqueSkillId = /^skill-[a-f0-9]{24}$/u;
const noQueryKeys = new Set<string>();
const conversationPageQueryKeys = new Set(["cursor"]);
const pathQueryKeys = new Set(["path"]);
const skillQueryKeys = new Set(["id"]);

const emptyQuerySchema = z.object({}).strict();
const scopedConversationPageQuerySchema = z
  .object({
    cursor: z.string().min(1).max(6_000).regex(scopedCursor).optional(),
  })
  .strict();
const directoryQuerySchema = z
  .object({
    path: z.string().max(SOURCE_LIMITS.maxPathCharacters).optional(),
  })
  .strict();
const previewQuerySchema = z
  .object({
    path: z.string().min(1).max(SOURCE_LIMITS.maxPathCharacters),
  })
  .strict();
const skillQuerySchema = z
  .object({
    id: z.string().regex(opaqueSkillId),
  })
  .strict();
const scopedTaskIdSchema = z.string().min(1).max(6_000).regex(scopedTaskId);

function queryRecord(request: Request, allowedKeys: ReadonlySet<string>): Record<string, string> {
  const output = Object.create(null) as Record<string, string>;
  let count = 0;
  for (const [key, value] of new URL(request.url).searchParams) {
    count += 1;
    if (
      count > maxQueryParameters ||
      key.length > maxQueryKeyCharacters ||
      !allowedKeys.has(key) ||
      Object.hasOwn(output, key)
    ) {
      throw new SourceSecurityError("invalid_path");
    }
    output[key] = value;
  }
  return output;
}

function parseQuery<T>(
  request: Request,
  schema: z.ZodType<T>,
  allowedKeys: ReadonlySet<string>,
): T {
  const parsed = schema.safeParse(queryRecord(request, allowedKeys));
  if (!parsed.success) throw new SourceSecurityError("invalid_path");
  return parsed.data;
}

export function assertNoQuery(request: Request): void {
  parseQuery(request, emptyQuerySchema, noQueryKeys);
}

export function parseScopedConversationPageQuery(request: Request): {
  cursor: string | null;
} {
  const parsed = parseQuery(request, scopedConversationPageQuerySchema, conversationPageQueryKeys);
  return { cursor: parsed.cursor ?? null };
}

export function parseScopedConversationRequest(
  request: Request,
  id: string,
  claude = false,
): string {
  if (claude) parseClaudeQuery(request);
  else assertNoQuery(request);
  const parsed = scopedTaskIdSchema.safeParse(id);
  if (!parsed.success) throw new SourceSecurityError("invalid_path");
  return parsed.data;
}

export function parseDirectoryQuery(request: Request): string {
  const { path = "" } = parseQuery(request, directoryQuerySchema, pathQueryKeys);
  parseRelativePath(path);
  return path;
}

export function parsePreviewQuery(request: Request): string {
  const { path } = parseQuery(request, previewQuerySchema, pathQueryKeys);
  parseRelativePath(path);
  return path;
}

export function parseSkillQuery(request: Request): string {
  return parseQuery(request, skillQuerySchema, skillQueryKeys).id;
}

export function parseClaudeQuery(
  request: Request,
  kind: "scope" | "page" | "directory" | "preview" = "scope",
) {
  const allowedKeys = new Set([
    "project",
    ...(kind === "page" ? ["cursor", "session"] : []),
    ...(["directory", "preview"].includes(kind) ? ["path"] : []),
  ]);
  const parsed = parseQuery(
    request,
    z
      .object({
        project: claudeProjectIdSchema.optional(),
        cursor: z.string().min(1).max(6000).regex(scopedCursor).optional(),
        session: scopedTaskIdSchema.optional(),
        path: z.string().max(SOURCE_LIMITS.maxPathCharacters).optional(),
      })
      .strict(),
    allowedKeys,
  );
  if (kind === "preview" && !parsed.path) throw new SourceSecurityError("invalid_path");
  if (parsed.path !== undefined) parseRelativePath(parsed.path);
  return {
    projectId: parsed.project ?? null,
    cursor: parsed.cursor ?? null,
    sessionId: parsed.session ?? null,
    path: parsed.path ?? "",
  };
}
