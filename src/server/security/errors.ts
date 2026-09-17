import "server-only";

import {
  SAFE_ERROR_MESSAGES,
  type AgentPanelId,
  type ScopedSafeErrorCode,
} from "@/contracts/agents";

export type SafeErrorCode = ScopedSafeErrorCode;

export class SourceSecurityError extends Error {
  readonly code: SafeErrorCode;

  constructor(code: SafeErrorCode) {
    super(SAFE_ERROR_MESSAGES[code]);
    this.name = "SourceSecurityError";
    this.code = code;
  }
}

export interface SafeDiagnostic {
  sourceId: string;
  code: SafeErrorCode;
  message: string;
  observedAt: string;
}

function sqliteCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("code" in value)) return undefined;
  return typeof value.code === "string" ? value.code : undefined;
}

export function classifySourceError(error: unknown): SafeErrorCode {
  if (error instanceof SourceSecurityError) return error.code;
  const code = sqliteCode(error);
  if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") return "source_busy";
  if (code === "SQLITE_NOTADB" || code === "SQLITE_FORMAT" || code?.startsWith("SQLITE_CORRUPT")) {
    return "source_malformed";
  }
  if (code === "SQLITE_CANTOPEN") return "source_unavailable";
  if (error instanceof SyntaxError) return "source_malformed";
  return "source_unavailable";
}

export function toSafeDiagnostic(
  error: unknown,
  sourceId: string,
  now = new Date(),
): SafeDiagnostic {
  const code = classifySourceError(error);
  return { sourceId, code, message: SAFE_ERROR_MESSAGES[code], observedAt: now.toISOString() };
}

export function logSafeDiagnostic(
  diagnostic: Pick<SafeDiagnostic, "sourceId" | "code"> & {
    readonly panelId?: AgentPanelId | undefined;
  },
): void {
  console.error("[cockpit] source request failed", {
    sourceId: diagnostic.sourceId,
    code: diagnostic.code,
    ...(diagnostic.panelId ? { panelId: diagnostic.panelId } : {}),
  });
}
