import "server-only";

import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";

import { CODEX_LIMITS } from "./limits.mjs";
import { assertOwnedTempDirectory, type OwnedTemp } from "./owned-temp.mjs";
import { SourceSecurityError } from "@/server/security/errors";

type RecordValue = Record<string, unknown>;
interface RecordedTurn {
  status: "completed" | "interrupted" | "failed" | "inProgress";
  items: unknown[];
  itemsView: "full";
}
export interface PaginatedHistory {
  turns: RecordedTurn[];
  unsupportedRecords: number;
  localHistoryOnly: true;
}

const MAX_RECORDS = 100_000;
const object = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 256;
const unsupported = () => ({ type: "unsupportedRecordedActivity" });

function malformed(): never {
  throw new SourceSecurityError("source_malformed");
}

function durationMs(value: unknown): number | null {
  if (!object(value) || typeof value.secs !== "number" || typeof value.nanos !== "number")
    return null;
  const ms = value.secs * 1_000 + Math.floor(value.nanos / 1_000_000);
  return Number.isSafeInteger(ms) && ms >= 0 ? ms : null;
}

/** Translate only recorded display fields; never reconstruct raw tool calls or reasoning. */
function recordedItem(item: RecordValue): unknown {
  if (item.type === "UserMessage") {
    if (!Array.isArray(item.content)) return unsupported();
    return {
      type: "userMessage",
      content: item.content.map((part: unknown) => {
        if (!object(part)) return { type: "unsupported" };
        if (part.type === "text" && typeof part.text === "string")
          return { type: "text", text: part.text };
        return { type: part.type };
      }),
    };
  }
  if (item.type === "AgentMessage") {
    if (!Array.isArray(item.content)) return unsupported();
    const parts: string[] = [];
    for (const part of item.content) {
      if (!object(part) || part.type !== "Text" || typeof part.text !== "string")
        return unsupported();
      parts.push(part.text);
    }
    return { type: "agentMessage", text: parts.join("\n"), phase: item.phase };
  }
  if (item.type === "Reasoning") {
    // raw_content, encrypted_content, and response_item reasoning are never read.
    return { type: "reasoning", summary: item.summary_text };
  }
  if (item.type === "Plan") return { type: "plan", text: item.text };
  if (item.type === "CommandExecution") {
    return {
      type: "commandExecution",
      status: item.status,
      cwd: item.cwd,
      commandActions: Array.isArray(item.parsed_cmd)
        ? item.parsed_cmd.map((action: unknown) => {
            if (!object(action)) return { type: "unknown" };
            const type = action.type === "list_files" ? "listFiles" : action.type;
            return type === "read" || type === "search" || type === "listFiles"
              ? { type, path: action.path }
              : { type: "unknown" };
          })
        : [],
      aggregatedOutput: item.aggregated_output,
      exitCode: item.exit_code,
      durationMs: durationMs(item.duration),
    };
  }
  if (item.type === "FileChange") {
    return {
      type: "fileChange",
      status: item.status,
      changes: Array.isArray(item.changes)
        ? item.changes.map((change: unknown) =>
            object(change) ? { path: change.path, diff: change.diff, kind: change.kind } : {},
          )
        : null,
    };
  }
  if (item.type === "ImageView") return { type: "imageView", path: item.path };
  if (item.type === "WebSearch") return { type: "webSearch" };
  const hiddenTypes: Record<string, string> = {
    McpToolCall: "mcpToolCall",
    DynamicToolCall: "dynamicToolCall",
    CollabAgentToolCall: "collabAgentToolCall",
    ImageGeneration: "imageGeneration",
  };
  if (typeof item.type === "string" && Object.hasOwn(hiddenTypes, item.type))
    return { type: hiddenTypes[item.type], status: item.status };
  return unsupported();
}

/** Pure, bounded decoder for one selected 0.145.0 rollout. No referenced path is followed. */
export function parsePaginatedRollout(text: string, taskId: string): PaginatedHistory | null {
  if (Buffer.byteLength(text) > CODEX_LIMITS.rolloutBytes)
    throw new SourceSecurityError("source_too_large");
  const firstEnd = text.indexOf("\n");
  let header: unknown;
  try {
    header = JSON.parse(firstEnd < 0 ? text : text.slice(0, firstEnd));
  } catch {
    return malformed();
  }
  if (!object(header) || header.type !== "session_meta" || !object(header.payload))
    return malformed();
  if (header.payload.id !== taskId) throw new SourceSecurityError("protocol_violation");
  const mode = header.payload.history_mode;
  if (mode === undefined || mode === "legacy") return null;
  if (mode !== "paginated" || firstEnd < 0) return malformed();

  const turns = new Map<string, RecordedTurn>();
  const seenItems = new Map<string, Map<string, string>>();
  let unsupportedRecords = 0;
  let records = 0;
  let hasResponseItems = false;
  function turnFor(id: unknown): RecordedTurn {
    if (!identifier(id)) return malformed();
    let turn = turns.get(id);
    if (!turn) {
      turn = { status: "inProgress", items: [], itemsView: "full" };
      turns.set(id, turn);
      seenItems.set(id, new Map());
    }
    return turn;
  }
  // Ignore model context, response_item mirrors, and inherited-history references.
  // Only explicit lifecycle and completed-item events establish display history.
  let position = firstEnd + 1;
  while (position < text.length) {
    const newline = text.indexOf("\n", position);
    const line = text.slice(position, newline < 0 ? text.length : newline);
    position = newline < 0 ? text.length : newline + 1;
    if (++records > MAX_RECORDS) throw new SourceSecurityError("source_too_large");
    if (!line.trim()) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      return malformed();
    }
    if (!object(record)) return malformed();
    if (record.type === "session_meta") return malformed();
    if (record.type === "response_item") hasResponseItems = true;
    if (record.type !== "event_msg") continue;
    if (!object(record.payload)) return malformed();
    const event = record.payload;
    if (event.thread_id !== undefined && event.thread_id !== taskId)
      throw new SourceSecurityError("protocol_violation");
    if (event.type === "thread_rolled_back") return malformed();
    if (event.type === "task_started") {
      const turn = turnFor(event.turn_id);
      if (turn.status !== "inProgress") return malformed();
    } else if (event.type === "task_complete") {
      turnFor(event.turn_id).status = event.error == null ? "completed" : "failed";
    } else if (event.type === "turn_aborted") {
      turnFor(event.turn_id).status = "interrupted";
    } else if (event.type === "item_completed") {
      const turn = turnFor(event.turn_id);
      const item = event.item;
      if (!object(item) || !identifier(item.id)) return malformed();
      const translated = recordedItem(item);
      const fingerprint = JSON.stringify(translated);
      const seen = seenItems.get(event.turn_id as string)!;
      const previous = seen.get(item.id);
      if (previous !== undefined) {
        if (previous !== fingerprint) return malformed();
        continue;
      }
      seen.set(item.id, fingerprint);
      turn.items.push(translated);
    } else if (event.type !== "thread_settings_applied" && event.type !== "token_count") {
      unsupportedRecords += 1;
    }
  }
  // An empty event view must not turn a nonempty transcript into a false empty state.
  if (hasResponseItems && ![...turns.values()].some((turn) => turn.items.length > 0))
    return malformed();
  return { turns: [...turns.values()], unsupportedRecords, localHistoryOnly: true };
}

/** Reads only the fixed, already copied file inside this operation's owned home. */
export async function readPaginatedRollout({
  owner,
  taskId,
  signal,
}: {
  owner: OwnedTemp;
  taskId: string;
  signal?: AbortSignal;
}): Promise<PaginatedHistory | null> {
  assertOwnedTempDirectory(owner.directory);
  if (signal?.aborted) throw new SourceSecurityError("source_unavailable");
  const file = await open(
    path.join(owner.directory, "selected.jsonl"),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const before = await file.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.nlink !== 1n ||
      typeof process.geteuid !== "function" ||
      before.uid !== BigInt(process.geteuid()) ||
      (before.mode & 0o7777n) !== 0o600n
    )
      throw new SourceSecurityError("source_unavailable");
    if (before.size > BigInt(CODEX_LIMITS.rolloutBytes))
      throw new SourceSecurityError("source_too_large");
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      if (signal?.aborted) throw new SourceSecurityError("source_unavailable");
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new SourceSecurityError("source_busy");
      offset += bytesRead;
    }
    const after = await file.stat({ bigint: true });
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs)
      throw new SourceSecurityError("source_busy");
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return malformed();
    }
    return parsePaginatedRollout(text, taskId);
  } finally {
    await file.close();
  }
}
