import "server-only";

import { homedir } from "node:os";

import { z } from "zod";

import {
  codexTaskDetailSchema,
  codexTaskPageSchema,
  type SafeProcessRow,
  type codexTaskSummarySchema,
} from "@/contracts/codex";
import { containsCredentialText, isCredentialFilename } from "@/lib/browser-safety";
import type { PanelTokenCodec, PanelTokenScope } from "@/server/panels/opaque-token";
import type { CodexPanelDescriptor } from "@/server/panels/registry";
import { cleanCodexText, isWellFormedUnicode } from "@/server/codex/safe-text";
import { SOURCE_LIMITS } from "@/server/security/limits";
import { redactBrowserText } from "@/server/security/redaction";
import { SourceSecurityError } from "@/server/security/errors";
import { resolveApprovedWorkspacePath } from "@/server/security/path-policy";

const utf8 = new TextEncoder();
const PROJECT_FORBIDDEN =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
const GENERIC_HOME_ROOT = /^\/(?:Users|home)\/[^/]+$/u;

const TASK_PAGE_SIZE = 5;
const MAX_PROJECT_SCALARS = 80;
const MAX_PROJECT_BYTES = 256;
const MAX_TITLE_SCALARS = 500;
const MAX_TITLE_BYTES = 2_000;
const MAX_PREVIEW_SCALARS = 1_000;
const MAX_PREVIEW_BYTES = 4_000;
const MAX_TURNS = 100;
const MAX_MESSAGES = 250;
const MAX_MESSAGE_SCALARS = 20_000;
const MAX_MESSAGE_BYTES = 64 * 1_024;
const MAX_TRANSCRIPT_BYTES = 256 * 1_024;
const MAX_PROCESS_ROWS_PER_TURN = 40;
const MAX_PROCESS_ROWS_PER_TASK = 300;
const MAX_PROCESS_SOURCE_ITEMS_PER_TURN = 200;
const MAX_REASONING_SUMMARY_PARTS = 100;
const MAX_PROCESS_TEXT_SCALARS = 4_000;
const MAX_PROCESS_TEXT_BYTES = 16 * 1_024;
const MAX_PROCESS_TOTAL_BYTES = 64 * 1_024;
const MAX_COMMAND_PREVIEW_SCALARS = 1_024;
const MAX_COMMAND_PREVIEW_BYTES = 4_096;
const MAX_COMMAND_OUTPUT_BYTES = 8 * 1_024;
const MAX_COMMAND_OUTPUT_LINES = 120;
const MAX_PATCH_SCALARS = 24_576;
const MAX_PATCH_BYTES = 24 * 1_024;
const MAX_PATCH_LINES = 300;
const MAX_CHANGE_PATHS = 50;
const MAX_SERIALIZED_DETAIL_BYTES = 512 * 1_024;

const sourceDecoder = z.union([z.string(), z.object({})]);
const threadBaseDecoder = z.object({
  id: z.string(),
  agentNickname: z.unknown().optional(),
  agentRole: z.unknown().optional(),
  cwd: z.unknown(),
  ephemeral: z.boolean(),
  name: z.unknown().optional(),
  parentThreadId: z.unknown().optional(),
  preview: z.unknown(),
  recencyAt: z.unknown().optional(),
  source: sourceDecoder,
  status: z.unknown(),
  updatedAt: z.unknown(),
});

const listResultDecoder = z.object({
  data: z.array(threadBaseDecoder).max(TASK_PAGE_SIZE),
  nextCursor: z.string().nullable(),
});

const userInputDecoder = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("image") }),
  z.object({ type: z.literal("localImage") }),
  z.object({ type: z.literal("audio") }),
  z.object({ type: z.literal("localAudio") }),
  z.object({ type: z.literal("skill") }),
  z.object({ type: z.literal("mention") }),
]);

const userMessageDecoder = z.object({
  type: z.literal("userMessage"),
  content: z.array(userInputDecoder),
});
const agentMessageDecoder = z.object({
  type: z.literal("agentMessage"),
  text: z.string(),
  phase: z.enum(["commentary", "final_answer"]).nullable().optional(),
});
const terminalItemStatusDecoder = z.enum(["inProgress", "completed", "failed", "declined"]);
const commandActionDecoder = z.discriminatedUnion("type", [
  z.object({ type: z.literal("read"), path: z.string() }),
  z.object({ type: z.literal("listFiles"), path: z.string().nullable().optional() }),
  z.object({ type: z.literal("search"), path: z.string().nullable().optional() }),
  z.object({ type: z.literal("unknown") }),
]);
const planDecoder = z.object({ type: z.literal("plan"), text: z.string() });
const reasoningDecoder = z.object({
  type: z.literal("reasoning"),
  summary: z.array(z.string()),
});
const reasoningEnvelopeDecoder = z.object({
  type: z.literal("reasoning"),
  summary: z.unknown(),
});
const commandExecutionDecoder = z.object({
  type: z.literal("commandExecution"),
  status: terminalItemStatusDecoder,
  commandActions: z.array(commandActionDecoder),
  cwd: z.string(),
  aggregatedOutput: z.string().nullable().optional(),
  durationMs: z.number().int().nullable().optional(),
  exitCode: z.number().int().nullable().optional(),
});
const commandExecutionEnvelopeDecoder = z.object({
  status: terminalItemStatusDecoder,
  commandActions: z.unknown(),
});
const patchKindDecoder = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add") }),
  z.object({ type: z.literal("delete") }),
  z.object({ type: z.literal("update"), move_path: z.string().nullable().optional() }),
]);
const fileChangeDecoder = z.object({
  type: z.literal("fileChange"),
  status: terminalItemStatusDecoder,
  changes: z.array(
    z.object({
      path: z.string(),
      diff: z.string(),
      kind: patchKindDecoder,
    }),
  ),
});
const fileChangeEnvelopeDecoder = z.object({
  status: terminalItemStatusDecoder,
  changes: z.unknown(),
});
const imageViewDecoder = z.object({ type: z.literal("imageView"), path: z.string() });
const webSearchDecoder = z.object({ type: z.literal("webSearch") });
const hiddenStatusDecoder = z.object({
  type: z.enum(["mcpToolCall", "dynamicToolCall", "collabAgentToolCall"]),
  status: z.enum(["inProgress", "completed", "failed"]),
});
const imageGenerationStatusDecoder = z.object({
  type: z.literal("imageGeneration"),
  status: terminalItemStatusDecoder,
});
const genericItemDecoder = z.object({ type: z.string() });
const turnDecoder = z.object({
  items: z.array(z.unknown()),
  itemsView: z.enum(["notLoaded", "summary", "full"]).optional(),
  status: z.enum(["completed", "interrupted", "failed", "inProgress"]),
});
const detailResultDecoder = z.object({
  thread: threadBaseDecoder.extend({ turns: z.array(turnDecoder) }),
  localHistoryOnly: z.literal(true).optional(),
  unsupportedRecords: z.number().int().nonnegative().max(100_000).optional(),
});

type TaskSummary = z.infer<typeof codexTaskSummarySchema>;
type TaskPage = z.infer<typeof codexTaskPageSchema>;
type TaskDetail = z.infer<typeof codexTaskDetailSchema>;
type Omission = TaskDetail["omitted"][number];
type RawThread = z.infer<typeof threadBaseDecoder>;
type RawTurn = z.infer<typeof turnDecoder>;
type SafeMessageRole = TaskDetail["turns"][number]["messages"][number]["role"];

interface ProjectionOptions {
  readonly panel: CodexPanelDescriptor;
  readonly now?: Date;
  readonly operatorHome?: string;
}

interface PageProjectionOptions extends ProjectionOptions {
  readonly tokens: PanelTokenCodec;
}

interface DetailProjectionOptions extends ProjectionOptions {
  readonly publicTaskId: string;
  readonly expectedRawTaskId: string;
}

interface DraftMessage {
  readonly role: SafeMessageRole;
  content: string;
  keep: boolean;
}

interface DraftTurn {
  readonly status: TaskDetail["turns"][number]["status"];
  readonly messages: DraftMessage[];
  readonly omitted: Omission[];
  processRows: SafeProcessRow[] | null;
  readonly processOmitted: Omission[];
}

function protocolViolation(): never {
  throw new SourceSecurityError("protocol_violation");
}

function decode<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return protocolViolation();
  return parsed.data;
}

function parseOutput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return protocolViolation();
  return parsed.data;
}

function panelScope(panel: CodexPanelDescriptor): PanelTokenScope {
  if (
    panel.id !== "codex" ||
    panel.name !== "Codex" ||
    panel.runtime !== "codex" ||
    panel.adapterVersion !== "codex-0.145.0"
  )
    return protocolViolation();
  return {
    panelId: panel.id,
    runtime: panel.runtime,
    adapterVersion: panel.adapterVersion,
  };
}

function scalarCountWithin(value: string, maximum: number): boolean {
  let count = 0;
  for (let index = 0; index < value.length;) {
    count += 1;
    if (count > maximum) return false;
    index += (value.codePointAt(index) ?? 0) > 0xffff ? 2 : 1;
  }
  return true;
}

function within(value: string, maxScalars: number, maxBytes: number): boolean {
  return scalarCountWithin(value, maxScalars) && utf8.encode(value).byteLength <= maxBytes;
}

function trimTrailingSeparators(value: string): string {
  let end = value.length;
  while (end > 1 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}

function boundText(
  value: string,
  maxScalars: number,
  maxBytes: number,
): { text: string; truncated: boolean } {
  if (within(value, maxScalars, maxBytes)) return { text: value, truncated: false };
  let text = "";
  let scalars = 0;
  let bytes = 0;
  for (const character of value) {
    const characterBytes = utf8.encode(character).byteLength;
    if (scalars === maxScalars || bytes + characterBytes > maxBytes) break;
    text += character;
    scalars += 1;
    bytes += characterBytes;
  }
  return { text, truncated: true };
}

function metadataText(
  value: unknown,
  panel: CodexPanelDescriptor,
  operatorHome: string,
  maxScalars: number,
  maxBytes: number,
): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const cleaned = cleanCodexText(value, panel, operatorHome).text;
  return cleaned !== null && within(cleaned, maxScalars, maxBytes) ? cleaned : null;
}

function sourceLabel(source: RawThread["source"]): TaskSummary["source"] | null {
  if (source === "cli") return "CLI";
  if (source === "vscode") return "VS Code";
  if (source === "appServer") return "App Server";
  return null;
}

function interactiveThread(thread: RawThread): boolean {
  return (
    sourceLabel(thread.source) !== null &&
    thread.ephemeral === false &&
    (thread.parentThreadId === undefined || thread.parentThreadId === null) &&
    (thread.agentNickname === undefined || thread.agentNickname === null) &&
    (thread.agentRole === undefined || thread.agentRole === null)
  );
}

function threadStatus(value: unknown): TaskSummary["status"] {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !("type" in value))
    return "unknown";
  if (value.type === "idle") return "idle";
  if (
    value.type === "active" &&
    "activeFlags" in value &&
    Array.isArray(value.activeFlags) &&
    value.activeFlags.every((flag) => flag === "waitingOnApproval" || flag === "waitingOnUserInput")
  ) {
    return "active";
  }
  if (value.type === "systemError") return "error";
  return "unknown";
}

function timestamp(value: unknown): string | null {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 253_402_300_799
  )
    return null;
  const date = new Date(value * 1_000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function taskSummary(
  thread: RawThread,
  publicTaskId: string,
  panel: CodexPanelDescriptor,
  operatorHome: string,
): TaskSummary {
  const source = sourceLabel(thread.source);
  if (source === null) return protocolViolation();
  return {
    id: publicTaskId,
    title: metadataText(thread.name, panel, operatorHome, MAX_TITLE_SCALARS, MAX_TITLE_BYTES),
    preview: metadataText(
      thread.preview,
      panel,
      operatorHome,
      MAX_PREVIEW_SCALARS,
      MAX_PREVIEW_BYTES,
    ),
    source,
    lastActivity: timestamp(thread.recencyAt) ?? timestamp(thread.updatedAt),
    status: threadStatus(thread.status),
    projectLabel: projectCodexProjectLabel(thread.cwd, panel, operatorHome),
  };
}

function addOmission(target: Omission[], reason: Omission["reason"], count = 1): void {
  if (count <= 0) return;
  const label =
    reason === "limit"
      ? "Content omitted by limit"
      : reason === "policy"
        ? "Details hidden by policy"
        : "Unsupported activity omitted";
  const existing = target.find((candidate) => candidate.reason === reason);
  if (existing) {
    existing.count = Math.min(1_000_000, (existing.count ?? 0) + count);
    return;
  }
  target.push({ reason, label, count: Math.min(1_000_000, count) });
}

type TerminalItemStatus = "completed" | "failed" | "declined";
type ApprovedPath = ReturnType<typeof resolveApprovedWorkspacePath>;

function terminalItemStatus(value: unknown): TerminalItemStatus | undefined {
  return value === "completed" || value === "failed" || value === "declined" ? value : undefined;
}

function hiddenProcessRow(
  label: "Details hidden" | "Unsupported activity",
  itemType: "Command" | "Tool" | "Changes" | "Activity",
  status?: TerminalItemStatus,
): SafeProcessRow {
  return {
    type: "hidden",
    key: "process-1",
    label,
    itemType,
    ...(status === undefined ? {} : { status }),
    count: 1,
  };
}

function approvedPath(
  panel: CodexPanelDescriptor,
  candidate: string,
  options: {
    readonly base?: string;
    readonly kind: "file" | "directory" | "any";
    readonly allowMissing?: boolean;
  },
): ApprovedPath | null {
  const root = panel.configuration.workspaceRoot;
  if (!root) return null;
  try {
    return resolveApprovedWorkspacePath(root, candidate, options);
  } catch {
    return null;
  }
}

function boundedProcessText(
  value: string,
  panel: CodexPanelDescriptor,
  operatorHome: string,
  omitted: Omission[],
): string | null {
  const cleaned = cleanCodexText(value, panel, operatorHome);
  if (cleaned.policyChanged) addOmission(omitted, "policy");
  if (cleaned.text === null) {
    if (!cleaned.policyChanged) addOmission(omitted, "policy");
    return null;
  }
  const bounded = boundText(cleaned.text, MAX_PROCESS_TEXT_SCALARS, MAX_PROCESS_TEXT_BYTES);
  if (bounded.truncated) addOmission(omitted, "limit");
  return bounded.text || null;
}

function actionTarget(
  panel: CodexPanelDescriptor,
  cwd: string,
  action: z.infer<typeof commandActionDecoder>,
):
  | { readonly target: { readonly path: ApprovedPath; readonly preview: string } }
  | { readonly reason: "policy" | "limit" } {
  let pathProof: ApprovedPath | null = null;
  let preview = "";
  if (action.type === "read") {
    if (!action.path.startsWith("/")) return { reason: "policy" };
    pathProof = approvedPath(panel, action.path, { kind: "file" });
    if (pathProof) preview = `Read ${pathProof.relativePath}`;
  } else if (action.type === "listFiles") {
    const candidate =
      action.path === null || action.path === undefined || action.path === "." ? cwd : action.path;
    pathProof = approvedPath(panel, candidate, {
      ...(candidate === cwd || candidate.startsWith("/") ? {} : { base: cwd }),
      kind: "directory",
    });
    if (pathProof) {
      preview =
        pathProof.relativePath === ""
          ? "List workspace files"
          : `List files in ${pathProof.relativePath}`;
    }
  } else if (action.type === "search") {
    const candidate =
      action.path === null || action.path === undefined || action.path === "." ? cwd : action.path;
    pathProof = approvedPath(panel, candidate, {
      ...(candidate === cwd || candidate.startsWith("/") ? {} : { base: cwd }),
      kind: "any",
    });
    if (pathProof) {
      if (pathProof.relativePath === "") return { reason: "policy" };
      preview = `Search in ${pathProof.relativePath}`;
    }
  }
  if (!pathProof) return { reason: "policy" };
  if (!within(preview, MAX_COMMAND_PREVIEW_SCALARS, MAX_COMMAND_PREVIEW_BYTES)) {
    return { reason: "limit" };
  }
  return { target: { path: pathProof, preview } };
}

function safeListOutput(
  value: string,
  listTarget: ApprovedPath,
  panel: CodexPanelDescriptor,
  omitted: Omission[],
): { text: string; truncated: false } | null {
  const normalized = value.replace(/\r\n?/gu, "\n");
  const lines = normalized.split("\n");
  if (
    utf8.encode(normalized).byteLength > MAX_COMMAND_OUTPUT_BYTES ||
    lines.length > MAX_COMMAND_OUTPUT_LINES
  ) {
    addOmission(omitted, "limit");
    return null;
  }
  const safeLines: string[] = [];
  for (const line of lines) {
    if (line === "") continue;
    if (line.startsWith("/")) {
      addOmission(omitted, "policy");
      return null;
    }
    const proof = approvedPath(panel, line, { base: listTarget.absolutePath, kind: "any" });
    if (!proof || !proof.relativePath) {
      addOmission(omitted, "policy");
      return null;
    }
    safeLines.push(proof.relativePath);
  }
  const text = safeLines.join("\n");
  if (!text) return null;
  if (!within(text, 8_192, MAX_COMMAND_OUTPUT_BYTES)) {
    addOmission(omitted, "limit");
    return null;
  }
  return { text, truncated: false };
}

function extractUnifiedPatchBody(value: string): string | null {
  const lines = value.replace(/\r\n?/gu, "\n").split("\n");
  const firstHunk = lines.findIndex((line) => line.startsWith("@@ "));
  if (firstHunk < 0) return null;
  const body = lines.slice(firstHunk);
  let index = 0;
  while (index < body.length) {
    const header = body[index];
    if (!header) return null;
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/u.exec(header);
    if (!match) return null;
    let oldRemaining = match[2] === undefined ? 1 : Number(match[2]);
    let newRemaining = match[4] === undefined ? 1 : Number(match[4]);
    if (!Number.isSafeInteger(oldRemaining) || !Number.isSafeInteger(newRemaining)) return null;
    index += 1;
    let sawBodyLine = false;
    while (oldRemaining > 0 || newRemaining > 0) {
      const line = body[index];
      if (line === undefined) return null;
      if (line.startsWith(" ")) {
        oldRemaining -= 1;
        newRemaining -= 1;
      } else if (line.startsWith("-")) {
        oldRemaining -= 1;
      } else if (line.startsWith("+")) {
        newRemaining -= 1;
      } else if (line === "\\ No newline at end of file" && sawBodyLine) {
        index += 1;
        continue;
      } else {
        return null;
      }
      if (oldRemaining < 0 || newRemaining < 0) return null;
      sawBodyLine = true;
      index += 1;
      if (body[index] === "\\ No newline at end of file") index += 1;
    }
    if (!sawBodyLine && (match[2] !== "0" || match[4] !== "0")) return null;
    if (index === body.length - 1 && body[index] === "") index += 1;
  }
  return body.join("\n");
}

function renderedPatch(
  changes: z.infer<typeof fileChangeDecoder>["changes"],
  files: Array<{ readonly path: string; readonly change: "add" | "modify" | "delete" }>,
  panel: CodexPanelDescriptor,
  operatorHome: string,
  omitted: Omission[],
): { text: string; truncated: boolean } | null {
  const sections: string[] = [];
  let policyChanged = false;
  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index];
    const file = files[index];
    if (!change || !file) return null;
    const rawBody =
      change.kind.type === "update" ? extractUnifiedPatchBody(change.diff) : change.diff;
    if (rawBody === null) return null;
    const cleaned = cleanCodexText(rawBody, panel, operatorHome);
    if (cleaned.text === null && rawBody.length > 0) return null;
    policyChanged ||= cleaned.policyChanged;
    const body = cleaned.text ?? "";
    const oldHeader = file.change === "add" ? "/dev/null" : `a/${file.path}`;
    const newHeader = file.change === "delete" ? "/dev/null" : `b/${file.path}`;
    let renderedBody = body;
    if (file.change === "add")
      renderedBody = body
        .split("\n")
        .map((line) => `+${line}`)
        .join("\n");
    if (file.change === "delete")
      renderedBody = body
        .split("\n")
        .map((line) => `-${line}`)
        .join("\n");
    sections.push(
      [`--- ${oldHeader}`, `+++ ${newHeader}`, renderedBody].filter(Boolean).join("\n"),
    );
  }
  if (policyChanged) addOmission(omitted, "policy");
  const joined = sections.join("\n");
  if (!joined) return null;
  const lines = joined.split("\n");
  const lineBounded =
    lines.length > MAX_PATCH_LINES ? lines.slice(0, MAX_PATCH_LINES).join("\n") : joined;
  const bounded = boundText(lineBounded, MAX_PATCH_SCALARS, MAX_PATCH_BYTES);
  const truncated = lines.length > MAX_PATCH_LINES || bounded.truncated;
  if (truncated) addOmission(omitted, "limit");
  return bounded.text ? { text: bounded.text, truncated } : null;
}

function processCommand(
  raw: unknown,
  panel: CodexPanelDescriptor,
  omitted: Omission[],
): SafeProcessRow {
  const envelope = commandExecutionEnvelopeDecoder.safeParse(raw);
  const status = terminalItemStatus(envelope.success ? envelope.data.status : undefined);
  if (!envelope.success || !status) {
    addOmission(omitted, "policy");
    return hiddenProcessRow("Details hidden", "Command");
  }
  if (!Array.isArray(envelope.data.commandActions) || envelope.data.commandActions.length > 1) {
    addOmission(omitted, "policy");
    return { type: "command", key: "process-1", label: "Command", status };
  }
  const parsed = commandExecutionDecoder.safeParse(raw);
  if (!parsed.success) {
    addOmission(omitted, "policy");
    return { type: "command", key: "process-1", label: "Command", status };
  }
  const item = parsed.data;
  const row: Extract<SafeProcessRow, { type: "command" }> = {
    type: "command",
    key: "process-1",
    label: "Command",
    status,
    ...(Number.isSafeInteger(item.durationMs) && (item.durationMs ?? -1) >= 0
      ? { durationMs: item.durationMs ?? 0 }
      : {}),
    ...(Number.isSafeInteger(item.exitCode) &&
    (item.exitCode ?? 0) >= -2_147_483_648 &&
    (item.exitCode ?? 0) <= 2_147_483_647
      ? { exitCode: item.exitCode ?? 0 }
      : {}),
  };
  const action = item.commandActions.length === 1 ? item.commandActions[0] : undefined;
  const targetResult =
    action && action.type !== "unknown"
      ? actionTarget(panel, item.cwd, action)
      : { reason: "policy" as const };
  let target: { readonly path: ApprovedPath; readonly preview: string } | null = null;
  if ("target" in targetResult) {
    target = targetResult.target;
    row.preview = target.preview;
  } else {
    addOmission(omitted, targetResult.reason);
  }
  if (
    action?.type === "listFiles" &&
    target &&
    item.aggregatedOutput !== null &&
    item.aggregatedOutput !== undefined
  ) {
    const output = safeListOutput(item.aggregatedOutput, target.path, panel, omitted);
    if (output) row.output = output;
  }
  return row;
}

function processChanges(
  raw: unknown,
  threadCwd: unknown,
  panel: CodexPanelDescriptor,
  operatorHome: string,
  omitted: Omission[],
): SafeProcessRow {
  const envelope = fileChangeEnvelopeDecoder.safeParse(raw);
  const status = terminalItemStatus(envelope.success ? envelope.data.status : undefined);
  if (!status || !envelope.success || typeof threadCwd !== "string") {
    addOmission(omitted, "policy");
    return hiddenProcessRow("Details hidden", "Changes", status);
  }
  if (!Array.isArray(envelope.data.changes)) {
    addOmission(omitted, "policy");
    return hiddenProcessRow("Details hidden", "Changes", status);
  }
  if (envelope.data.changes.length > MAX_CHANGE_PATHS) {
    addOmission(omitted, "limit", envelope.data.changes.length - MAX_CHANGE_PATHS);
    return hiddenProcessRow("Details hidden", "Changes", status);
  }
  const parsed = fileChangeDecoder.safeParse(raw);
  if (!parsed.success) {
    addOmission(omitted, "policy");
    return hiddenProcessRow("Details hidden", "Changes", status);
  }
  const files: Array<{ path: string; change: "add" | "modify" | "delete" }> = [];
  for (const change of parsed.data.changes) {
    if (
      change.kind.type === "update" &&
      change.kind.move_path !== null &&
      change.kind.move_path !== undefined
    ) {
      addOmission(omitted, "policy");
      return hiddenProcessRow("Details hidden", "Changes", status);
    }
    const mapped = change.kind.type === "update" ? "modify" : change.kind.type;
    const proof = approvedPath(panel, change.path, {
      ...(change.path.startsWith("/") ? {} : { base: threadCwd }),
      kind: "file",
      ...(mapped === "modify" ? {} : { allowMissing: true }),
    });
    if (
      !proof ||
      !proof.relativePath ||
      proof.relativePath.length > SOURCE_LIMITS.maxPathCharacters
    ) {
      addOmission(omitted, "policy");
      return hiddenProcessRow("Details hidden", "Changes", status);
    }
    files.push({ path: proof.relativePath, change: mapped });
  }
  const patch = renderedPatch(parsed.data.changes, files, panel, operatorHome, omitted);
  if (parsed.data.changes.some((change) => change.diff.length > 0) && patch === null) {
    addOmission(omitted, "policy");
  }
  return {
    type: "changes",
    key: "process-1",
    status,
    files,
    ...(patch ? { patch } : {}),
  };
}

const hiddenItemTypes = Object.freeze({
  hookPrompt: "Activity",
  mcpToolCall: "Tool",
  dynamicToolCall: "Tool",
  collabAgentToolCall: "Activity",
  subAgentActivity: "Activity",
  sleep: "Activity",
  imageGeneration: "Tool",
  enteredReviewMode: "Activity",
  exitedReviewMode: "Activity",
  contextCompaction: "Activity",
} satisfies Record<string, "Tool" | "Activity">);

function processItem(
  raw: unknown,
  threadCwd: unknown,
  panel: CodexPanelDescriptor,
  operatorHome: string,
  omitted: Omission[],
): SafeProcessRow | null {
  const tagged = genericItemDecoder.safeParse(raw);
  if (!tagged.success) {
    addOmission(omitted, "unsupported");
    return hiddenProcessRow("Unsupported activity", "Activity");
  }
  const type = tagged.data.type;
  if (type === "userMessage") return null;
  if (type === "agentMessage") {
    const parsed = agentMessageDecoder.safeParse(raw);
    if (!parsed.success) {
      addOmission(omitted, "policy");
      return hiddenProcessRow("Details hidden", "Activity");
    }
    if (parsed.data.phase !== "commentary") return null;
    const text = boundedProcessText(parsed.data.text, panel, operatorHome, omitted);
    if (!text) {
      return hiddenProcessRow("Details hidden", "Activity");
    }
    return { type: "progress", key: "process-1", text };
  }
  if (type === "reasoning") {
    const envelope = reasoningEnvelopeDecoder.safeParse(raw);
    if (!envelope.success || !Array.isArray(envelope.data.summary)) {
      addOmission(omitted, "policy");
      return hiddenProcessRow("Details hidden", "Activity");
    }
    const retained = envelope.data.summary.slice(-MAX_REASONING_SUMMARY_PARTS);
    if (envelope.data.summary.length > retained.length) {
      addOmission(omitted, "limit", envelope.data.summary.length - retained.length);
    }
    const parsed = reasoningDecoder.safeParse({ type: "reasoning", summary: retained });
    const text = parsed.success
      ? boundedProcessText(parsed.data.summary.join("\n"), panel, operatorHome, omitted)
      : null;
    if (!text) {
      if (!parsed.success) addOmission(omitted, "policy");
      return hiddenProcessRow("Details hidden", "Activity");
    }
    return { type: "reasoning_summary", key: "process-1", text };
  }
  if (type === "plan") {
    const parsed = planDecoder.safeParse(raw);
    const text = parsed.success
      ? boundedProcessText(parsed.data.text, panel, operatorHome, omitted)
      : null;
    if (!text) {
      if (!parsed.success) addOmission(omitted, "policy");
      return hiddenProcessRow("Details hidden", "Activity");
    }
    return { type: "plan", key: "process-1", text };
  }
  if (type === "commandExecution") return processCommand(raw, panel, omitted);
  if (type === "fileChange") {
    return processChanges(raw, threadCwd, panel, operatorHome, omitted);
  }
  if (type === "imageView") {
    const parsed = imageViewDecoder.safeParse(raw);
    const proof =
      parsed.success && typeof threadCwd === "string"
        ? approvedPath(panel, parsed.data.path, {
            ...(parsed.data.path.startsWith("/") ? {} : { base: threadCwd }),
            kind: "file",
          })
        : null;
    if (!proof || !proof.relativePath) {
      addOmission(omitted, "policy");
      return hiddenProcessRow("Details hidden", "Tool");
    }
    if (!within(proof.relativePath, 240, 960)) {
      addOmission(omitted, "limit");
      return hiddenProcessRow("Details hidden", "Tool");
    }
    return {
      type: "tool",
      key: "process-1",
      label: "Viewed image",
      fields: [{ label: "File", value: proof.relativePath }],
    };
  }
  if (type === "webSearch") {
    webSearchDecoder.parse(raw);
    return { type: "tool", key: "process-1", label: "Web search", fields: [] };
  }
  if (Object.hasOwn(hiddenItemTypes, type)) {
    const parsedStatus =
      type === "imageGeneration"
        ? imageGenerationStatusDecoder.safeParse(raw)
        : hiddenStatusDecoder.safeParse(raw);
    const status = parsedStatus.success ? terminalItemStatus(parsedStatus.data.status) : undefined;
    addOmission(omitted, "policy");
    return hiddenProcessRow(
      "Details hidden",
      hiddenItemTypes[type as keyof typeof hiddenItemTypes],
      status,
    );
  }
  addOmission(omitted, "unsupported");
  return hiddenProcessRow("Unsupported activity", "Activity");
}

function aggregateProcessRows(
  rows: SafeProcessRow[],
  row: SafeProcessRow,
  adjacent: boolean,
): void {
  const previous = rows.at(-1);
  if (
    adjacent &&
    row.type === "hidden" &&
    previous?.type === "hidden" &&
    row.label === previous.label &&
    row.itemType === previous.itemType &&
    row.status === previous.status
  ) {
    previous.count = Math.min(1_000_000, previous.count + row.count);
    return;
  }
  rows.push(row);
}

function isProcessSourceItem(raw: unknown): boolean {
  const tagged = genericItemDecoder.safeParse(raw);
  if (!tagged.success) return true;
  if (tagged.data.type === "userMessage") return false;
  if (tagged.data.type !== "agentMessage") return true;
  const agent = agentMessageDecoder.safeParse(raw);
  return !agent.success || agent.data.phase === "commentary";
}

function draftProcess(
  items: readonly unknown[],
  threadCwd: unknown,
  panel: CodexPanelDescriptor,
  operatorHome: string,
): { rows: SafeProcessRow[]; omitted: Omission[] } {
  const rows: SafeProcessRow[] = [];
  const omitted: Omission[] = [];
  const retainedItems: Array<{ readonly item: unknown; readonly rawIndex: number }> = [];
  let droppedItems = 0;
  for (let rawIndex = items.length - 1; rawIndex >= 0; rawIndex -= 1) {
    const item = items[rawIndex];
    if (!isProcessSourceItem(item)) continue;
    if (retainedItems.length < MAX_PROCESS_SOURCE_ITEMS_PER_TURN) {
      retainedItems.push({ item, rawIndex });
    } else {
      droppedItems += 1;
    }
  }
  retainedItems.reverse();
  if (droppedItems > 0) addOmission(omitted, "limit", droppedItems);
  let previousWasHidden = false;
  let previousRawIndex: number | null = null;
  for (const retained of retainedItems) {
    const { item, rawIndex } = retained;
    const row = processItem(item, threadCwd, panel, operatorHome, omitted);
    if (!row) {
      previousWasHidden = false;
      previousRawIndex = rawIndex;
      continue;
    }
    aggregateProcessRows(rows, row, previousWasHidden && previousRawIndex === rawIndex - 1);
    previousWasHidden = row.type === "hidden";
    previousRawIndex = rawIndex;
  }
  if (rows.length > MAX_PROCESS_ROWS_PER_TURN) {
    addOmission(omitted, "limit", rows.length - MAX_PROCESS_ROWS_PER_TURN);
    return { rows: rows.slice(-MAX_PROCESS_ROWS_PER_TURN), omitted };
  }
  return { rows, omitted };
}

function processRowTextBytes(row: SafeProcessRow): number {
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
  return values.reduce(
    (total, value) => total + (value === undefined ? 0 : utf8.encode(value).byteLength),
    0,
  );
}

function processTextBytes(turns: readonly DraftTurn[]): number {
  return turns.reduce(
    (total, turn) =>
      total +
      (turn.processRows?.reduce((subtotal, row) => subtotal + processRowTextBytes(row), 0) ?? 0),
    0,
  );
}

function dropOldestProcessDetail(turns: DraftTurn[]): boolean {
  for (const turn of turns) {
    for (const row of turn.processRows ?? []) {
      if (row.type === "command" && row.output) {
        delete row.output;
        addOmission(turn.processOmitted, "limit");
        return true;
      }
      if (row.type === "changes" && row.patch) {
        delete row.patch;
        addOmission(turn.processOmitted, "limit");
        return true;
      }
    }
  }
  return false;
}

function dropOldestProcessRow(turns: DraftTurn[]): boolean {
  for (const turn of turns) {
    if (!turn.processRows?.length) continue;
    turn.processRows.shift();
    addOmission(turn.processOmitted, "limit");
    return true;
  }
  return false;
}

function applyProcessBudgets(turns: DraftTurn[]): void {
  let retainedRows = 0;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (!turn?.processRows) continue;
    const available = MAX_PROCESS_ROWS_PER_TASK - retainedRows;
    if (turn.processRows.length > available) {
      addOmission(turn.processOmitted, "limit", turn.processRows.length - Math.max(0, available));
      turn.processRows = available > 0 ? turn.processRows.slice(-available) : [];
    }
    retainedRows += turn.processRows.length;
  }
  while (processTextBytes(turns) > MAX_PROCESS_TOTAL_BYTES) {
    if (dropOldestProcessDetail(turns)) continue;
    if (!dropOldestProcessRow(turns)) return protocolViolation();
  }
}

const placeholders = Object.freeze({
  image: "Image input omitted",
  localImage: "Image input omitted",
  audio: "Audio input omitted",
  localAudio: "Audio input omitted",
  skill: "Skill input omitted",
  mention: "Mention input omitted",
});

function userMessage(
  item: z.infer<typeof userMessageDecoder>,
  panel: CodexPanelDescriptor,
  operatorHome: string,
  omitted: Omission[],
): DraftMessage | null {
  const parts: string[] = [];
  for (const input of item.content) {
    if (input.type !== "text") {
      parts.push(placeholders[input.type]);
      continue;
    }
    const cleaned = cleanCodexText(input.text, panel, operatorHome);
    if (cleaned.policyChanged) addOmission(omitted, "policy");
    if (cleaned.text !== null) parts.push(cleaned.text);
  }
  if (parts.length === 0) return null;
  const bounded = boundText(parts.join("\n"), MAX_MESSAGE_SCALARS, MAX_MESSAGE_BYTES);
  if (bounded.truncated) addOmission(omitted, "limit");
  if (!bounded.text) return null;
  return { role: "user", content: bounded.text, keep: true };
}

function finalMessage(
  item: z.infer<typeof agentMessageDecoder>,
  panel: CodexPanelDescriptor,
  operatorHome: string,
  omitted: Omission[],
): DraftMessage | null {
  const cleaned = cleanCodexText(item.text, panel, operatorHome);
  if (cleaned.policyChanged) addOmission(omitted, "policy");
  if (cleaned.text === null) return null;
  const bounded = boundText(cleaned.text, MAX_MESSAGE_SCALARS, MAX_MESSAGE_BYTES);
  if (bounded.truncated) addOmission(omitted, "limit");
  if (!bounded.text) return null;
  return { role: "assistant", content: bounded.text, keep: true };
}

const terminalWithoutFinal = Object.freeze({
  completed: "Completed without a final answer.",
  interrupted: "Interrupted before a final answer.",
  failed: "Failed before a final answer.",
});

function draftTurn(
  turn: RawTurn,
  threadCwd: unknown,
  panel: CodexPanelDescriptor,
  operatorHome: string,
): DraftTurn {
  const omitted: Omission[] = [];
  const messages: DraftMessage[] = [];
  const process =
    turn.status === "inProgress"
      ? { rows: null, omitted: [] as Omission[] }
      : draftProcess(turn.items, threadCwd, panel, operatorHome);
  let finalCount = 0;
  for (const rawItem of turn.items) {
    const user = userMessageDecoder.safeParse(rawItem);
    if (user.success) {
      const projected = userMessage(user.data, panel, operatorHome, omitted);
      if (projected) messages.push(projected);
      continue;
    }
    const agent = agentMessageDecoder.safeParse(rawItem);
    if (turn.status !== "inProgress" && agent.success && agent.data.phase === "final_answer") {
      const projected = finalMessage(agent.data, panel, operatorHome, omitted);
      if (projected) {
        messages.push(projected);
        finalCount += 1;
      }
    }
  }
  if (turn.status === "inProgress") {
    messages.push({ role: "status", content: "Still in progress; refresh later", keep: true });
    return {
      status: "in-progress",
      messages,
      omitted,
      processRows: null,
      processOmitted: process.omitted,
    };
  }
  if (finalCount === 0) {
    messages.push({
      role: "status" as const,
      content: terminalWithoutFinal[turn.status],
      keep: true,
    });
  }
  return {
    status: turn.status,
    messages,
    omitted,
    processRows: process.rows,
    processOmitted: process.omitted,
  };
}

function applyTranscriptBudget(turns: DraftTurn[]): void {
  let retainedMessages = 0;
  let retainedBytes = 0;
  let exhausted = false;
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex];
    if (!turn) continue;
    for (let messageIndex = turn.messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
      const message = turn.messages[messageIndex];
      if (!message) continue;
      const bytes = utf8.encode(message.content).byteLength;
      if (
        exhausted ||
        retainedMessages === MAX_MESSAGES ||
        retainedBytes + bytes > MAX_TRANSCRIPT_BYTES
      ) {
        message.keep = false;
        addOmission(turn.omitted, "limit");
        exhausted = true;
      } else {
        retainedMessages += 1;
        retainedBytes += bytes;
      }
    }
  }
}

function mergeOmissions(...groups: readonly Omission[][]): Omission[] {
  const merged: Omission[] = [];
  for (const group of groups) {
    for (const omission of group) addOmission(merged, omission.reason, omission.count ?? 1);
  }
  return merged;
}

function renderDetail(
  summary: TaskSummary,
  drafts: DraftTurn[],
  observedAt: string,
  omitted: Omission[],
  localHistoryOnly = false,
): TaskDetail {
  for (;;) {
    let messageOrdinal = 0;
    let processOrdinal = 0;
    const turns = drafts.map((turn, turnIndex) => {
      const rows = turn.processRows ?? [];
      const process =
        rows.length === 0
          ? null
          : {
              count: rows.length,
              rows: rows.map((row) => {
                processOrdinal += 1;
                return { ...row, key: `process-${processOrdinal}` };
              }),
              omitted: turn.processOmitted,
            };
      return {
        key: `turn-${turnIndex + 1}`,
        status: turn.status,
        messages: turn.messages
          .filter((message) => message.keep)
          .map((message) => {
            messageOrdinal += 1;
            return {
              key: `message-${messageOrdinal}`,
              role: message.role,
              content: message.content,
            };
          }),
        process,
        omitted:
          process === null ? mergeOmissions(turn.omitted, turn.processOmitted) : turn.omitted,
      };
    });
    const candidate = {
      summary,
      turns,
      observedAt,
      omitted,
      ...(localHistoryOnly
        ? {
            historyNote: "Local recorded history only; inherited history is not followed." as const,
          }
        : {}),
    };
    if (utf8.encode(JSON.stringify(candidate)).byteLength <= MAX_SERIALIZED_DETAIL_BYTES) {
      return parseOutput(codexTaskDetailSchema, candidate);
    }

    if (dropOldestProcessDetail(drafts) || dropOldestProcessRow(drafts)) continue;

    let protectedMessage: DraftMessage | undefined;
    for (let turnIndex = drafts.length - 1; turnIndex >= 0 && !protectedMessage; turnIndex -= 1) {
      const turn = drafts[turnIndex];
      if (!turn) continue;
      for (let messageIndex = turn.messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
        const message = turn.messages[messageIndex];
        if (message?.keep && (message.role === "assistant" || message.role === "status")) {
          protectedMessage = message;
          break;
        }
      }
    }

    let removed = false;
    for (const turn of drafts) {
      const message = turn.messages.find(
        (candidateMessage) => candidateMessage.keep && candidateMessage !== protectedMessage,
      );
      if (!message) continue;
      message.keep = false;
      addOmission(turn.omitted, "limit");
      removed = true;
      break;
    }
    if (!removed && protectedMessage) {
      protectedMessage.keep = false;
      const turn = drafts.find((candidateTurn) =>
        candidateTurn.messages.includes(protectedMessage),
      );
      if (turn) addOmission(turn.omitted, "limit");
      removed = true;
    }
    if (!removed) return protocolViolation();
  }
}

export function projectCodexProjectLabel(
  cwd: unknown,
  panel: CodexPanelDescriptor,
  operatorHome = homedir(),
): string | null {
  if (
    typeof cwd !== "string" ||
    cwd.length === 0 ||
    cwd.length > SOURCE_LIMITS.maxPathCharacters ||
    !isWellFormedUnicode(cwd) ||
    PROJECT_FORBIDDEN.test(cwd) ||
    cwd.includes("\\") ||
    !cwd.startsWith("/") ||
    cwd.startsWith("//")
  )
    return null;
  const normalized = trimTrailingSeparators(cwd);
  const normalizedOperatorHome =
    typeof operatorHome === "string" && isWellFormedUnicode(operatorHome)
      ? trimTrailingSeparators(operatorHome)
      : "";
  const normalizedCodexHome =
    typeof panel.configuration.home === "string" && isWellFormedUnicode(panel.configuration.home)
      ? trimTrailingSeparators(panel.configuration.home)
      : "";
  if (
    normalized === "/" ||
    normalized === "/root" ||
    GENERIC_HOME_ROOT.test(normalized) ||
    normalized === normalizedOperatorHome ||
    normalized === normalizedCodexHome
  )
    return null;
  const segments = normalized.slice(1).split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  const label = segments.at(-1);
  if (
    !label ||
    label.includes("/") ||
    label.includes("\\") ||
    PROJECT_FORBIDDEN.test(label) ||
    !isWellFormedUnicode(label) ||
    isCredentialFilename(label) ||
    containsCredentialText(label) ||
    redactBrowserText(label) !== label ||
    !within(label, MAX_PROJECT_SCALARS, MAX_PROJECT_BYTES)
  )
    return null;
  return label;
}

export function projectCodexTaskPage(result: unknown, options: PageProjectionOptions): TaskPage {
  const decoded = decode(listResultDecoder, result);
  const scope = panelScope(options.panel);
  const operatorHome = options.operatorHome ?? homedir();
  const items: TaskSummary[] = [];
  for (const thread of decoded.data) {
    if (!interactiveThread(thread)) continue;
    let publicTaskId: string;
    try {
      publicTaskId = options.tokens.encodeTask(scope, thread.id);
    } catch {
      return protocolViolation();
    }
    items.push(taskSummary(thread, publicTaskId, options.panel, operatorHome));
  }
  let nextCursor: string | null = null;
  if (decoded.nextCursor !== null) {
    try {
      nextCursor = options.tokens.encodeCursor(scope, decoded.nextCursor);
    } catch {
      return protocolViolation();
    }
  }
  return parseOutput(codexTaskPageSchema, {
    items,
    nextCursor,
    observedAt: (options.now ?? new Date()).toISOString(),
    indexScope: "Codex state database",
    inventoryNote: "State-database index; some local tasks may be absent.",
  });
}

export function projectCodexTaskDetail(
  result: unknown,
  options: DetailProjectionOptions,
): TaskDetail {
  panelScope(options.panel);
  const decoded = decode(detailResultDecoder, result);
  if (decoded.thread.id !== options.expectedRawTaskId || !interactiveThread(decoded.thread)) {
    return protocolViolation();
  }
  if (
    decoded.thread.turns.some(
      (turn) => turn.itemsView === "summary" || turn.itemsView === "notLoaded",
    )
  ) {
    return protocolViolation();
  }
  const operatorHome = options.operatorHome ?? homedir();
  const omitted: Omission[] = [];
  const retainedTurns = decoded.thread.turns.slice(-MAX_TURNS);
  addOmission(omitted, "unsupported", decoded.unsupportedRecords ?? 0);
  addOmission(omitted, "limit", decoded.thread.turns.length - retainedTurns.length);
  const drafts = retainedTurns.map((turn) =>
    draftTurn(turn, decoded.thread.cwd, options.panel, operatorHome),
  );
  applyTranscriptBudget(drafts);
  applyProcessBudgets(drafts);
  return renderDetail(
    taskSummary(decoded.thread, options.publicTaskId, options.panel, operatorHome),
    drafts,
    (options.now ?? new Date()).toISOString(),
    omitted,
    decoded.localHistoryOnly === true,
  );
}
