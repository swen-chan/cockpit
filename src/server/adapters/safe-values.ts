import "server-only";

import type { SafeErrorCode } from "@/server/security/errors";
import { redactBrowserText, redactMachinePaths } from "@/server/security/redaction";

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function safeIdentifier(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\u0000-\u001F\u007F]/gu, " ").trim();
  if (!normalized) return null;
  const pathSafe = redactMachinePaths(normalized);
  const redacted = redactBrowserText(pathSafe);
  if (redacted !== pathSafe) return null;
  return Array.from(pathSafe).slice(0, maxLength).join("");
}

export function sourceStateForCode(code: SafeErrorCode): "unavailable" | "error" {
  return code === "missing_source" ? "unavailable" : "error";
}

export function formatByteCount(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
}
