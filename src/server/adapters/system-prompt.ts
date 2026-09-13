import "server-only";

import path from "node:path";

import type { SystemSource } from "@/contracts/cockpit";
import type { HermesContext } from "@/server/config/hermes-context";
import type { PrivateSourceManifest } from "@/server/config/source-manifest";
import { safeIdentifier, sourceStateForCode } from "@/server/adapters/safe-values";
import { classifySourceError, SourceSecurityError } from "@/server/security/errors";
import { boundUtf8Text, SOURCE_LIMITS } from "@/server/security/limits";
import { parseRelativePath } from "@/server/security/path-policy";
import { redactBrowserText } from "@/server/security/redaction";
import { withReadOnlyDatabase, type ReadOnlyDatabase } from "@/server/sqlite/read-only";

type ConversationManifest = PrivateSourceManifest["conversation"];

interface PromptRow {
  embedded_fallback: number;
  hash_matched: number;
  prompt: string | null;
  prompt_bytes: number | null;
  prompt_hash: string | null;
  session_time: number;
  title: string | null;
}

type PromptDatabaseReader = <T>(
  filename: string,
  read: (database: ReadOnlyDatabase) => T | Promise<T>,
  options: { protectedSourceRoots: readonly string[] },
) => Promise<T>;

export interface ReadSystemPromptOptions {
  databaseReader?: PromptDatabaseReader;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function mappedColumn(
  available: ReadonlySet<string>,
  identifier: string | undefined,
): string | null {
  return identifier && available.has(identifier) ? quoteIdentifier(identifier) : null;
}

function safeSessionTime(value: number, fallback: Date): string {
  if (!Number.isFinite(value) || value <= 0) return fallback.toISOString();
  const milliseconds = value > 10_000_000_000 ? value : value * 1_000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.valueOf()) ? fallback.toISOString() : date.toISOString();
}

export function unavailableSystemPrompt(
  state: "unavailable" | "error",
  code: string,
  now: Date,
  metadata: SystemSource["metadata"] = [],
): SystemSource {
  return {
    id: "prompt",
    title: "System Prompt",
    category: "Prompt snapshot",
    summary: "The prompt snapshot used by the latest eligible conversation.",
    content: state === "unavailable"
      ? "No eligible System Prompt snapshot is available for the resolved profile."
      : "Cockpit could not safely read the latest System Prompt snapshot.",
    stamp: {
      id: "system-prompt",
      label: "Conversation source",
      path: "<CONVERSATION_STORE> / <PROMPT_RECORDS>",
      observedAt: now.toISOString(),
      state,
    },
    metadata: [
      ...metadata,
      { label: "Diagnostic", value: code, mono: true },
      { label: "Content", value: "Not sent to browser" },
    ],
  };
}

function readLatestPrompt(database: ReadOnlyDatabase, manifest: ConversationManifest): PromptRow | undefined {
  const sessionTable = quoteIdentifier(manifest.sessionTable);
  const sessionColumnRows = database.prepare<[], { name: string }>(`PRAGMA table_info(${sessionTable})`).all();
  const columns = new Set(sessionColumnRows.map((row) => row.name));
  const mapped = manifest.sessionColumns;
  for (const required of [mapped.id, mapped.source, mapped.startedAt]) {
    if (!columns.has(required)) throw new SourceSecurityError("source_malformed");
  }

  const id = quoteIdentifier(mapped.id);
  const source = quoteIdentifier(mapped.source);
  const startedAt = quoteIdentifier(mapped.startedAt);
  const title = mappedColumn(columns, mapped.title);
  const endedAt = mappedColumn(columns, mapped.endedAt);
  const lastActivityAt = mappedColumn(columns, mapped.lastActivityAt);
  const messageCount = mappedColumn(columns, mapped.messageCount);
  const hidden = mappedColumn(columns, mapped.hidden);
  const archived = mappedColumn(columns, mapped.archived);
  const promptHash = mappedColumn(columns, mapped.promptHash);
  const embeddedPrompt = mappedColumn(columns, mapped.embeddedPrompt);
  if (!messageCount || !hidden || !archived || !embeddedPrompt) {
    throw new SourceSecurityError("source_malformed");
  }

  const activityColumns = [lastActivityAt, endedAt, startedAt].filter((value): value is string => value !== null);
  const activity = activityColumns.length === 1 ? `s.${activityColumns[0]}` : `COALESCE(${activityColumns.map((name) => `s.${name}`).join(", ")})`;

  let promptExpression = embeddedPrompt ? `s.${embeddedPrompt}` : "NULL";
  let hashMatchedExpression = "0";
  let promptJoin = "";
  const promptTableName = manifest.promptTable;
  const promptColumnMapping = manifest.promptColumns;
  if (promptTableName && promptColumnMapping && promptHash) {
    const tableExists = database.prepare<[string], { present: number }>(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    ).get(promptTableName);
    if (tableExists) {
      const promptTable = quoteIdentifier(promptTableName);
      const promptColumnRows = database.prepare<[], { name: string }>(`PRAGMA table_info(${promptTable})`).all();
      const promptColumns = new Set(promptColumnRows.map((row) => row.name));
      const hashColumn = promptColumnMapping.hash;
      const bodyColumn = promptColumnMapping.prompt;
      if (promptColumns.has(hashColumn) && promptColumns.has(bodyColumn)) {
        const snapshotPrompt = `p.${quoteIdentifier(bodyColumn)}`;
        promptExpression = embeddedPrompt ? `COALESCE(${snapshotPrompt}, s.${embeddedPrompt})` : snapshotPrompt;
        hashMatchedExpression = `CASE WHEN ${snapshotPrompt} IS NOT NULL THEN 1 ELSE 0 END`;
        promptJoin = `LEFT JOIN ${promptTable} p ON p.${quoteIdentifier(hashColumn)} = s.${promptHash}`;
      }
    }
  }

  const where = [
    `LOWER(s.${source}) <> 'cron'`,
    `COALESCE(s.${hidden}, 0) = 0`,
    `COALESCE(s.${archived}, 0) = 0`,
    `COALESCE(s.${messageCount}, 0) > 0`,
  ];
  const sql = `
    SELECT
      ${title ? `s.${title}` : "NULL"} AS title,
      ${activity} AS session_time,
      ${promptHash ? `s.${promptHash}` : "NULL"} AS prompt_hash,
      substr(${promptExpression}, 1, ${SOURCE_LIMITS.maxPreviewCharacters + 1}) AS prompt,
      length(CAST(${promptExpression} AS BLOB)) AS prompt_bytes,
      ${hashMatchedExpression} AS hash_matched,
      CASE WHEN s.${embeddedPrompt} IS NOT NULL THEN 1 ELSE 0 END AS embedded_fallback
    FROM ${sessionTable} s
    ${promptJoin}
    WHERE ${where.join(" AND ")}
    ORDER BY ${activity} DESC, s.${id} DESC
    LIMIT 1
  `;
  return database.prepare<[], PromptRow>(sql).get();
}

export async function readSystemPrompt(
  context: HermesContext,
  manifest: ConversationManifest,
  now: Date = new Date(),
  options: ReadSystemPromptOptions = {},
): Promise<SystemSource> {
  const databasePath = path.join(context.home, ...parseRelativePath(manifest.databaseRelativePath));
  try {
    const row = await (options.databaseReader ?? withReadOnlyDatabase)(
      databasePath,
      (database) => readLatestPrompt(database, manifest),
      { protectedSourceRoots: [context.home] },
    );
    if (!row) return unavailableSystemPrompt("unavailable", "no_eligible_session", now);

    const sessionTitle = safeIdentifier(row.title, 200) ?? "Untitled conversation";
    const sessionTime = safeSessionTime(row.session_time, now);
    if (typeof row.prompt !== "string" || !row.prompt) {
      return unavailableSystemPrompt("unavailable", "prompt_unavailable", now, [
        { label: "Used by", value: sessionTitle },
        { label: "Session time", value: sessionTime, mono: true },
      ]);
    }

    const bounded = boundUtf8Text(redactBrowserText(row.prompt));
    const promptBytes = Number.isSafeInteger(row.prompt_bytes) && (row.prompt_bytes ?? 0) >= 0
      ? row.prompt_bytes ?? bounded.originalBytes
      : bounded.originalBytes;
    const promptHash = typeof row.prompt_hash === "string" && /^[A-Fa-f0-9]{8,128}$/u.test(row.prompt_hash)
      ? `${row.prompt_hash.slice(0, 10)}…`
      : "Unavailable";
    const resolution = row.hash_matched === 1
      ? "Hash-matched snapshot"
      : row.embedded_fallback === 1
        ? "Embedded compatibility fallback"
        : "Unavailable";

    return {
      id: "prompt",
      title: "System Prompt",
      category: "Prompt snapshot",
      summary: "The prompt snapshot used by the latest eligible conversation.",
      content: bounded.text,
      stamp: {
        id: "system-prompt",
        label: "Conversation source",
        path: "<CONVERSATION_STORE> / <PROMPT_RECORDS>",
        observedAt: now.toISOString(),
        state: "ready",
        ...(bounded.truncated || promptBytes > SOURCE_LIMITS.maxPreviewBytes ? { truncated: true } : {}),
      },
      metadata: [
        { label: "Used by", value: sessionTitle },
        { label: "Session time", value: sessionTime, mono: true },
        { label: "Fingerprint", value: promptHash, mono: true },
        { label: "Resolution", value: resolution },
      ],
    };
  } catch (error) {
    const code = classifySourceError(error);
    return unavailableSystemPrompt(sourceStateForCode(code), code, now);
  }
}
