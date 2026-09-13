import "server-only";

import { z } from "zod";

import { SourceSecurityError } from "@/server/security/errors";
import { SOURCE_LIMITS } from "@/server/security/limits";
import { parseRelativePath } from "@/server/security/path-policy";

const maxQueryParameters = 4;
const maxQueryKeyCharacters = 32;
const opaqueConversationId = /^conversation-[A-Za-z0-9_-]+$/u;
const opaqueCursor = /^cursor-[A-Za-z0-9_-]+$/u;
const opaqueSkillId = /^skill-[a-f0-9]{24}$/u;
const noQueryKeys = new Set<string>();
const conversationPageQueryKeys = new Set(["cursor", "limit"]);
const pathQueryKeys = new Set(["path"]);
const skillQueryKeys = new Set(["id"]);

const emptyQuerySchema = z.object({}).strict();
const conversationPageQuerySchema = z.object({
  cursor: z.string().min(1).max(500).regex(opaqueCursor).optional(),
  limit: z.string().regex(/^(?:[1-9]|1[0-9]|2[0-5])$/u).optional(),
}).strict();
const directoryQuerySchema = z.object({
  path: z.string().max(SOURCE_LIMITS.maxPathCharacters).optional(),
}).strict();
const previewQuerySchema = z.object({
  path: z.string().min(1).max(SOURCE_LIMITS.maxPathCharacters),
}).strict();
const skillQuerySchema = z.object({
  id: z.string().regex(opaqueSkillId),
}).strict();
const conversationIdSchema = z.string().min(1).max(500).regex(opaqueConversationId);

function queryRecord(request: Request, allowedKeys: ReadonlySet<string>): Record<string, string> {
  const output = Object.create(null) as Record<string, string>;
  let count = 0;
  for (const [key, value] of new URL(request.url).searchParams) {
    count += 1;
    if (count > maxQueryParameters
      || key.length > maxQueryKeyCharacters
      || !allowedKeys.has(key)
      || Object.hasOwn(output, key)) {
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

export function parseConversationPageQuery(request: Request): {
  cursor: string | null;
  limit: number;
} {
  const parsed = parseQuery(request, conversationPageQuerySchema, conversationPageQueryKeys);
  return {
    cursor: parsed.cursor ?? null,
    limit: parsed.limit === undefined ? 5 : Number(parsed.limit),
  };
}

export function parseConversationRequest(request: Request, id: string): string {
  assertNoQuery(request);
  const parsed = conversationIdSchema.safeParse(id);
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
