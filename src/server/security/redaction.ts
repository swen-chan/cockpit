import "server-only";

const REDACTED = "[REDACTED]";
const credentialParameterPattern = /^(?:access[-_]?token|api[-_]?key|auth[-_]?token|authorization|client[-_]?secret|cookie|credential|id[-_]?token|pass[-_]?(?:phrase|word)|password|private[-_]?key|refresh[-_]?token|secret|session[-_]?token|token)$/iu;
const secretKeyPattern = /(authorization|api.?key|client.?secret|cookie|credential|pass.?phrase|password|private.?key|refresh.?token|secret|token)/iu;
const secretValuePatterns = [
  /(?<![A-Za-z0-9])(?:access[-_ ]?token|api[-_ ]?key|auth[-_ ]?token|authorization|client[-_ ]?secret|cookie|credential|id[-_ ]?token|pass[-_ ]?phrase|password|private[-_ ]?key|refresh[-_ ]?token|secret|session[-_ ]?token|token)\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,\r\n}]+)/giu,
  /(?<![A-Za-z0-9])Bearer\s+[A-Za-z0-9._~+/=-]{8,}/giu,
  /(?<![A-Za-z0-9])(?:gh[pousr]_|github_pat_)[A-Za-z0-9_-]{8,}/giu,
  /(?<![A-Za-z0-9])(?:sk-(?:(?:proj|svcacct|ant-api\d+|or-v1)-)[A-Za-z0-9_-]{8,}|sk[-_][A-Za-z0-9]{16,}|sk_(?:live|test)_[A-Za-z0-9]{16,})(?![A-Za-z0-9_-])/giu,
  /(?<![A-Za-z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])/gu,
  /(?<![A-Za-z0-9])AIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9])/gu,
  /(?<![A-Za-z0-9])eyJ[A-Za-z0-9_-]{5,2048}\.[A-Za-z0-9_-]{5,8192}\.[A-Za-z0-9_-]{8,2048}(?![A-Za-z0-9_-])/gu,
];
const machinePathPatterns = [
  /(?<![A-Za-z0-9:])\/Users\/[^/\s<>'"`]+(?:\/[^\s<>'"`]*)?/gu,
  /(?<![A-Za-z0-9:])\/home\/[^/\s<>'"`]+(?:\/[^\s<>'"`]*)?/gu,
  /(?<![A-Za-z0-9])[A-Za-z]:\\Users\\[^\\\s<>'"`]+(?:\\[^\s<>'"`]*)?/gu,
];

function redactString(value: string): string {
  return secretValuePatterns.reduce((current, pattern) => current.replace(pattern, REDACTED), value);
}

function hasCredentialParameter(parameters: URLSearchParams): boolean {
  return [...parameters.keys()].some((key) => credentialParameterPattern.test(key));
}

function hasUriCredentials(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value, "http://cockpit.invalid");
  } catch {
    return false;
  }
  if (url.username || url.password || hasCredentialParameter(url.searchParams)) return true;
  const fragment = url.hash.slice(1);
  const fragmentQuery = fragment.includes("?") ? fragment.slice(fragment.indexOf("?") + 1) : fragment;
  return hasCredentialParameter(new URLSearchParams(fragmentQuery));
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
  return redactString(value) !== value || hasUriCredentials(value);
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
