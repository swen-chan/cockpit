import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import path from "node:path";

import type { Conversation, ConversationMessage, ConversationPage, ConversationSummary } from "@/contracts/cockpit";
import { safeIdentifier } from "@/server/adapters/safe-values";
import type { HermesContext } from "@/server/config/hermes-context";
import type { PrivateSourceManifest } from "@/server/config/source-manifest";
import { SourceSecurityError } from "@/server/security/errors";
import { parseRelativePath } from "@/server/security/path-policy";
import { redactBrowserText } from "@/server/security/redaction";
import { withReadOnlyDatabase, type ReadOnlyDatabase } from "@/server/sqlite/read-only";

type ConversationManifest = PrivateSourceManifest["conversation"];
type DatabaseReader = <T>(
  filename: string,
  read: (database: ReadOnlyDatabase) => T | Promise<T>,
  options: { protectedSourceRoots: readonly string[] },
) => Promise<T>;

export interface ConversationReadOptions {
  databaseReader?: DatabaseReader;
}

interface PrivateIdentity {
  rawId: string;
  time: number;
  version: 1;
}

interface ConversationSchema {
  archived: string;
  hidden: string;
  id: string;
  messageCount: string;
  messageTable: string;
  messages: {
    active: string;
    compacted: string | null;
    content: string;
    displayKind: string | null;
    id: string;
    role: string;
    sessionId: string;
    timestamp: string;
    toolName: string | null;
  };
  model: string | null;
  profile: string | null;
  source: string;
  startedAt: string;
  title: string | null;
  toolCallCount: string | null;
  workspace: string | null;
}

interface ConversationRow {
  activity: number;
  message_count: number | null;
  model: string | null;
  preview: string | null;
  profile: string | null;
  raw_id: string;
  source: string;
  title: string | null;
  tool_call_count: number | null;
  workspace: string | null;
}

interface MessageRow {
  message_characters: number | null;
  raw_id: string | number;
  role: string;
  safe_content: string | null;
  timestamp: number;
  tool_name: string | null;
}

const defaultPageSize = 5;
const maxPageSize = 25;
const maxCursorCharacters = 500;
const maxPreviewCharacters = 160;
const maxMessageCharacters = 20_000;
const maxTranscriptCharacters = 100_000;
const maxTranscriptMessages = 500;
function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function mappedColumn(available: ReadonlySet<string>, identifier: string | undefined): string | null {
  return identifier && available.has(identifier) ? quoteIdentifier(identifier) : null;
}

function requiredColumn(available: ReadonlySet<string>, identifier: string): string {
  const column = mappedColumn(available, identifier);
  if (!column) throw new SourceSecurityError("source_malformed");
  return column;
}

function tableColumns(database: ReadOnlyDatabase, table: string): Set<string> {
  const rows = database.prepare<[], { name: string }>(`PRAGMA table_info(${quoteIdentifier(table)})`).all();
  if (rows.length === 0) throw new SourceSecurityError("source_malformed");
  return new Set(rows.map((row) => row.name));
}

function inspectSchema(database: ReadOnlyDatabase, manifest: ConversationManifest): ConversationSchema {
  const messageManifest = manifest.messages;
  if (!messageManifest) throw new SourceSecurityError("source_malformed");
  const sessionColumns = tableColumns(database, manifest.sessionTable);
  const messageColumns = tableColumns(database, messageManifest.table);
  const sessions = manifest.sessionColumns;
  const messages = messageManifest.columns;
  const startedAt = requiredColumn(sessionColumns, sessions.startedAt);
  return {
    archived: requiredColumn(sessionColumns, sessions.archived),
    hidden: requiredColumn(sessionColumns, sessions.hidden),
    id: requiredColumn(sessionColumns, sessions.id),
    messageCount: requiredColumn(sessionColumns, sessions.messageCount),
    messageTable: quoteIdentifier(messageManifest.table),
    messages: {
      active: requiredColumn(messageColumns, messages.active),
      compacted: mappedColumn(messageColumns, messages.compacted),
      content: requiredColumn(messageColumns, messages.content),
      displayKind: mappedColumn(messageColumns, messages.displayKind),
      id: requiredColumn(messageColumns, messages.id),
      role: requiredColumn(messageColumns, messages.role),
      sessionId: requiredColumn(messageColumns, messages.sessionId),
      timestamp: requiredColumn(messageColumns, messages.timestamp),
      toolName: mappedColumn(messageColumns, messages.toolName),
    },
    model: mappedColumn(sessionColumns, sessions.model),
    profile: mappedColumn(sessionColumns, sessions.profileName),
    source: requiredColumn(sessionColumns, sessions.source),
    startedAt,
    title: mappedColumn(sessionColumns, sessions.title),
    toolCallCount: mappedColumn(sessionColumns, sessions.toolCallCount),
    workspace: mappedColumn(sessionColumns, sessions.workspace),
  };
}

function eligibility(schema: ConversationSchema): string {
  return [
    `LOWER(s.${schema.source}) <> 'cron'`,
    `COALESCE(s.${schema.hidden}, 0) = 0`,
    `COALESCE(s.${schema.archived}, 0) = 0`,
    `COALESCE(s.${schema.messageCount}, 0) > 0`,
  ].join(" AND ");
}

function visibleMessageFilter(schema: ConversationSchema, alias: string): string {
  const message = schema.messages;
  const compactedFilter = message.compacted ? `AND COALESCE(${alias}.${message.compacted}, 0) = 0` : "";
  const displayFilter = message.displayKind
    ? `AND COALESCE(${alias}.${message.displayKind}, '') NOT IN ('hidden', 'internal_notification')`
    : "";
  return `
    COALESCE(${alias}.${message.active}, 0) = 1
    ${compactedFilter}
    ${displayFilter}
  `;
}

function activityExpression(schema: ConversationSchema): string {
  const message = schema.messages;
  return `COALESCE((
    SELECT MAX(activity_message.${message.timestamp})
    FROM ${schema.messageTable} activity_message
    WHERE activity_message.${message.sessionId} = s.${schema.id}
      AND ${visibleMessageFilter(schema, "activity_message")}
      AND LOWER(activity_message.${message.role}) IN ('user', 'assistant')
      AND activity_message.${message.content} IS NOT NULL
      AND length(trim(activity_message.${message.content})) > 0
  ), s.${schema.startedAt})`;
}

function identityKey(context: HermesContext, manifest: ConversationManifest): Buffer {
  return createHash("sha256").update(JSON.stringify({
    database: manifest.databaseRelativePath,
    home: context.home,
    id: manifest.sessionColumns.id,
    namespace: "cockpit-conversation-token-v1",
    table: manifest.sessionTable,
  })).digest();
}

function encodeIdentity(prefix: "conversation" | "cursor", rawId: string, time: number, key: Buffer): string {
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, initializationVector);
  const payload: PrivateIdentity = { rawId, time, version: 1 };
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return `${prefix}-${Buffer.concat([initializationVector, cipher.getAuthTag(), encrypted]).toString("base64url")}`;
}

function decodeIdentity(value: string, prefix: "conversation" | "cursor", key: Buffer): PrivateIdentity {
  if (typeof value !== "string" || value.length < prefix.length + 2 || value.length > maxCursorCharacters) {
    throw new SourceSecurityError("invalid_path");
  }
  const marker = `${prefix}-`;
  if (!value.startsWith(marker)) throw new SourceSecurityError("invalid_path");
  try {
    const token = Buffer.from(value.slice(marker.length), "base64url");
    if (token.length < 29) throw new Error("invalid identity");
    const decipher = createDecipheriv("aes-256-gcm", key, token.subarray(0, 12));
    decipher.setAuthTag(token.subarray(12, 28));
    const decrypted = Buffer.concat([decipher.update(token.subarray(28)), decipher.final()]).toString("utf8");
    const parsed: unknown = JSON.parse(decrypted);
    if (typeof parsed !== "object" || parsed === null) throw new Error("invalid identity");
    const candidate = parsed as Partial<PrivateIdentity>;
    if (candidate.version !== 1
      || typeof candidate.time !== "number"
      || !Number.isFinite(candidate.time)
      || candidate.time <= 0
      || typeof candidate.rawId !== "string"
      || candidate.rawId.length < 1
      || candidate.rawId.length > 200) {
      throw new Error("invalid identity");
    }
    return { rawId: candidate.rawId, time: candidate.time, version: 1 };
  } catch {
    throw new SourceSecurityError("invalid_path");
  }
}

function safeCount(value: number | null): number {
  return Number.isSafeInteger(value) && (value ?? -1) >= 0 ? value ?? 0 : 0;
}

function safeTime(value: number, fallback: number): string {
  const candidate = Number.isFinite(value) && value > 0 ? value : fallback;
  const milliseconds = candidate > 10_000_000_000 ? candidate : candidate * 1_000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.valueOf()) ? new Date(0).toISOString() : date.toISOString();
}

function safePreview(value: string | null): string {
  if (typeof value !== "string") return "No visible message preview.";
  const normalized = redactBrowserText(value).replace(/\s+/gu, " ").trim();
  return Array.from(normalized).slice(0, maxPreviewCharacters).join("") || "No visible message preview.";
}

function summaryFromRow(row: ConversationRow, key: Buffer): ConversationSummary {
  if (typeof row.raw_id !== "string" || !row.raw_id || !Number.isFinite(row.activity) || row.activity <= 0) {
    throw new SourceSecurityError("source_malformed");
  }
  return {
    id: encodeIdentity("conversation", row.raw_id, row.activity, key),
    title: safeIdentifier(row.title, 500) ?? "Untitled conversation",
    preview: safePreview(row.preview),
    source: safeIdentifier(row.source, 100) ?? "Unknown",
    lastActivity: safeTime(row.activity, 0),
    model: safeIdentifier(row.model, 200) ?? "Unavailable",
    messageCount: safeCount(row.message_count),
    toolCallCount: safeCount(row.tool_call_count),
    profile: safeIdentifier(row.profile, 100) ?? "Unavailable",
    workspace: safeIdentifier(redactBrowserText(row.workspace ?? ""), 500) ?? "Unavailable",
  };
}

function previewExpression(schema: ConversationSchema): string {
  const message = schema.messages;
  return `(
    SELECT substr(m.${message.content}, 1, ${maxPreviewCharacters + 1})
    FROM ${schema.messageTable} m
    WHERE m.${message.sessionId} = s.${schema.id}
      AND ${visibleMessageFilter(schema, "m")}
      AND LOWER(m.${message.role}) IN ('user', 'assistant')
      AND m.${message.content} IS NOT NULL
      AND length(trim(m.${message.content})) > 0
    ORDER BY m.${message.timestamp} DESC, m.${message.id} DESC
    LIMIT 1
  )`;
}

function conversationSelect(schema: ConversationSchema): string {
  return `
    s.${schema.id} AS raw_id,
    ${activityExpression(schema)} AS activity,
    ${schema.title ? `s.${schema.title}` : "NULL"} AS title,
    s.${schema.source} AS source,
    ${schema.model ? `s.${schema.model}` : "NULL"} AS model,
    s.${schema.messageCount} AS message_count,
    ${schema.toolCallCount ? `s.${schema.toolCallCount}` : "NULL"} AS tool_call_count,
    ${schema.profile ? `s.${schema.profile}` : "NULL"} AS profile,
    ${schema.workspace ? `s.${schema.workspace}` : "NULL"} AS workspace,
    ${previewExpression(schema)} AS preview
  `;
}

export async function readConversationPage(
  context: HermesContext,
  manifest: ConversationManifest,
  cursor: string | null = null,
  limit: number = defaultPageSize,
  now: Date = new Date(),
  options: ConversationReadOptions = {},
): Promise<ConversationPage> {
  if (!Number.isInteger(limit) || limit < 1 || limit > maxPageSize) {
    throw new SourceSecurityError("invalid_path");
  }
  const databasePath = path.join(context.home, ...parseRelativePath(manifest.databaseRelativePath));
  const key = identityKey(context, manifest);
  return (options.databaseReader ?? withReadOnlyDatabase)(databasePath, (database) => {
    const schema = inspectSchema(database, manifest);
    let cursorClause = "";
    let parameters: [number, number, string, number] | [number];
    if (cursor) {
      const identity = decodeIdentity(cursor, "cursor", key);
      cursorClause = "WHERE (activity < ? OR (activity = ? AND raw_id < ?))";
      parameters = [identity.time, identity.time, identity.rawId, limit + 1];
    } else {
      parameters = [limit + 1];
    }
    const sql = `
      WITH eligible_conversations AS (
        SELECT ${conversationSelect(schema)}
        FROM ${quoteIdentifier(manifest.sessionTable)} s
        WHERE ${eligibility(schema)}
      )
      SELECT * FROM eligible_conversations
      ${cursorClause}
      ORDER BY activity DESC, raw_id DESC
      LIMIT ?
    `;
    const rows = database.prepare<typeof parameters, ConversationRow>(sql).all(...parameters);
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map((row) => summaryFromRow(row, key)),
      nextCursor: hasMore && last ? encodeIdentity("cursor", last.raw_id, last.activity, key) : null,
      observedAt: now.toISOString(),
    };
  }, { protectedSourceRoots: [context.home] });
}

function messageRows(
  database: ReadOnlyDatabase,
  schema: ConversationSchema,
  rawSessionId: string,
): MessageRow[] {
  const message = schema.messages;
  return database.prepare<[string, number], MessageRow>(`
    SELECT
      m.${message.id} AS raw_id,
      LOWER(m.${message.role}) AS role,
      CASE WHEN LOWER(m.${message.role}) IN ('user', 'assistant')
        THEN substr(m.${message.content}, 1, ${maxMessageCharacters + 1}) ELSE NULL END AS safe_content,
      CASE WHEN LOWER(m.${message.role}) IN ('user', 'assistant')
        THEN length(m.${message.content}) ELSE NULL END AS message_characters,
      ${message.toolName ? `m.${message.toolName}` : "NULL"} AS tool_name,
      m.${message.timestamp} AS timestamp
    FROM ${schema.messageTable} m
    WHERE m.${message.sessionId} = ?
      AND ${visibleMessageFilter(schema, "m")}
      AND LOWER(m.${message.role}) IN ('user', 'assistant', 'tool')
    ORDER BY m.${message.timestamp} ASC, m.${message.id} ASC
    LIMIT ?
  `).all(rawSessionId, maxTranscriptMessages + 1);
}

function safeMessages(
  rows: MessageRow[],
  rawSessionId: string,
  fallbackTime: number,
): { messages: ConversationMessage[]; truncated: boolean } {
  const messages: ConversationMessage[] = [];
  let remaining = maxTranscriptCharacters;
  let truncated = rows.length > maxTranscriptMessages;
  for (const row of rows.slice(0, maxTranscriptMessages)) {
    const role = row.role === "user" || row.role === "assistant" || row.role === "tool" ? row.role : null;
    if (!role) continue;
    const rawContent = role === "tool"
      ? `${safeIdentifier(row.tool_name, 100) ?? "Tool"} activity`
      : typeof row.safe_content === "string" ? redactBrowserText(row.safe_content) : "";
    if (!rawContent.trim()) continue;
    const characters = Array.from(rawContent);
    const allowed = Math.min(remaining, maxMessageCharacters);
    if (allowed <= 0) {
      truncated = true;
      break;
    }
    const content = characters.slice(0, allowed).join("");
    if (characters.length > allowed || (row.message_characters ?? 0) > maxMessageCharacters) truncated = true;
    messages.push({
      id: `message-${createHash("sha256").update(`${rawSessionId}:${String(row.raw_id)}`).digest("hex").slice(0, 24)}`,
      role,
      content,
      timestamp: safeTime(row.timestamp, fallbackTime),
    });
    remaining -= characters.slice(0, allowed).length;
  }
  return { messages, truncated };
}

export async function readConversationTranscript(
  context: HermesContext,
  manifest: ConversationManifest,
  requestedId: string,
  options: ConversationReadOptions = {},
): Promise<Conversation> {
  const key = identityKey(context, manifest);
  const identity = decodeIdentity(requestedId, "conversation", key);
  const databasePath = path.join(context.home, ...parseRelativePath(manifest.databaseRelativePath));
  return (options.databaseReader ?? withReadOnlyDatabase)(databasePath, (database) => {
    const schema = inspectSchema(database, manifest);
    const rawId = identity.rawId;
    const row = database.prepare<[string], ConversationRow>(`
      WITH eligible_conversations AS (
        SELECT ${conversationSelect(schema)}
        FROM ${quoteIdentifier(manifest.sessionTable)} s
        WHERE ${eligibility(schema)}
      )
      SELECT * FROM eligible_conversations
      WHERE raw_id = ?
      LIMIT 1
    `).get(rawId);
    if (!row) throw new SourceSecurityError("missing_source");
    const safe = safeMessages(messageRows(database, schema, rawId), rawId, row.activity);
    return {
      ...summaryFromRow(row, key),
      id: requestedId,
      messages: safe.messages,
      ...(safe.truncated ? { truncated: true } : {}),
    };
  }, { protectedSourceRoots: [context.home] });
}
