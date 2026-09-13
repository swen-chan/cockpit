import "server-only";

export type SafeErrorCode =
  | "invalid_path"
  | "path_outside_root"
  | "excluded_path"
  | "missing_source"
  | "invalid_profile"
  | "source_busy"
  | "source_too_large"
  | "source_malformed"
  | "source_unavailable";

const publicMessages: Record<SafeErrorCode, string> = {
  invalid_path: "The requested relative path is invalid.",
  path_outside_root: "The requested path is outside the approved root.",
  excluded_path: "The requested path is excluded by Cockpit policy.",
  missing_source: "The requested local source is unavailable.",
  invalid_profile: "The selected Hermes profile is invalid or unavailable.",
  source_busy: "The local source is temporarily busy.",
  source_too_large: "The local source is too large to inspect safely.",
  source_malformed: "The local source could not be safely interpreted.",
  source_unavailable: "The local source could not be read.",
};

export class SourceSecurityError extends Error {
  readonly code: SafeErrorCode;

  constructor(code: SafeErrorCode) {
    super(publicMessages[code]);
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

export function toSafeDiagnostic(error: unknown, sourceId: string, now = new Date()): SafeDiagnostic {
  const code = classifySourceError(error);
  return { sourceId, code, message: publicMessages[code], observedAt: now.toISOString() };
}

export function logSafeDiagnostic(diagnostic: SafeDiagnostic): void {
  console.error("[cockpit] source request failed", {
    sourceId: diagnostic.sourceId,
    code: diagnostic.code,
  });
}
