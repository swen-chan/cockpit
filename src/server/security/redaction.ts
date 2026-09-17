import "server-only";

import { containsCredentialText, redactCredentialText } from "@/lib/browser-safety";

const REDACTED = "[REDACTED]";
const secretKeyPattern =
  /(authorization|api.?key|client.?secret|cookie|credential|pass.?phrase|password|private.?key|refresh.?token|secret|token)/iu;
const machinePathPatterns = [
  /(?<![A-Za-z0-9:])\/Users\/[^/\s<>'"`]+(?:\/[^\s<>'"`]*)?/gu,
  /(?<![A-Za-z0-9:])\/home\/[^/\s<>'"`]+(?:\/[^\s<>'"`]*)?/gu,
  /(?<![A-Za-z0-9])[A-Za-z]:\\Users\\[^\\\s<>'"`]+(?:\\[^\s<>'"`]*)?/gu,
];

function redactString(value: string): string {
  return redactCredentialText(value);
}

function redactValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (depth > 30) return "[REDACTED:DEPTH]";
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[REDACTED:CIRCULAR]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen, depth + 1));

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = secretKeyPattern.test(key) ? REDACTED : redactValue(item, seen, depth + 1);
  }
  return output;
}

export function redactSecrets(value: unknown): unknown {
  return redactValue(value, new WeakSet<object>(), 0);
}

export function containsSecrets(value: string): boolean {
  return containsCredentialText(value);
}

export function redactMachinePaths(value: string): string {
  return machinePathPatterns.reduce(
    (current, pattern) => current.replace(pattern, "<local-path>"),
    value,
  );
}

export function redactBrowserText(value: string): string {
  const redacted = redactSecrets(redactMachinePaths(value));
  return typeof redacted === "string" ? redacted : REDACTED;
}
