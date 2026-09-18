const REDACTED = "[REDACTED]";
const schemeUriPattern = /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>'"`]+/gu;
const protocolRelativeUriPattern = /(?<!:)\/\/[^\s<>'"`]+/gu;
const endpointTokenPattern = /[^\s<>'"`]+/gu;
const credentialParameterPattern =
  /^(?:access[-_]?token|api[-_]?key|auth[-_]?token|authorization|client[-_]?secret|cookie|credential|id[-_]?token|pass[-_]?(?:phrase|word)|password|private[-_]?key|refresh[-_]?token|secret|session[-_]?token|token)$/iu;
const secretValuePatterns = [
  /(?<![A-Za-z0-9])(?:access[-_ ]?token|api[-_ ]?key|auth[-_ ]?token|authorization|client[-_ ]?secret|cookie|credential|id[-_ ]?token|pass[-_ ]?phrase|password|private[-_ ]?key|refresh[-_ ]?token|secret|session[-_ ]?token|token)\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,\r\n}]+)/giu,
  /(?<![A-Za-z0-9])Bearer\s+[A-Za-z0-9._~+/=-]{8,}/giu,
  /(?<![A-Za-z0-9])(?:gh[pousr]_|github_pat_)[A-Za-z0-9_-]{8,}/giu,
  /(?<![A-Za-z0-9])(?:sk-(?:(?:proj|svcacct|ant-api\d+|or-v1)-)[A-Za-z0-9_-]{8,}|sk[-_][A-Za-z0-9]{16,}|sk_(?:live|test)_[A-Za-z0-9]{16,})(?![A-Za-z0-9_-])/giu,
  /(?<![A-Za-z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])/gu,
  /(?<![A-Za-z0-9])AIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9])/gu,
  /(?<![A-Za-z0-9])eyJ[A-Za-z0-9_-]{5,2048}\.[A-Za-z0-9_-]{5,8192}\.[A-Za-z0-9_-]{8,2048}(?![A-Za-z0-9_-])/gu,
];
const exactCredentialNames = new Set([
  "auth.json",
  "credentials.json",
  "credentials.yaml",
  "credentials.yml",
  "secrets.json",
  "secrets.yaml",
  "secrets.yml",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ecdsa_sk",
  "id_ed25519",
  "id_ed25519_sk",
  "id_xmss",
  ".netrc",
]);
const credentialExtensions = new Set([
  ".pem",
  ".key",
  ".ppk",
  ".p8",
  ".pk8",
  ".p12",
  ".pfx",
  ".jks",
  ".keystore",
]);
const backupSuffixes = new Set([".bak", ".backup", ".copy", ".old", ".orig", ".save"]);
const sensitiveStem =
  /(?:^|[._-])(api[-_]?keys?|auth|credentials?|oauth|private[-_]?keys?|secrets?|tokens?)(?:[._-]|$)/iu;

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
  const fragmentQuery = fragment.includes("?")
    ? fragment.slice(fragment.indexOf("?") + 1)
    : fragment;
  return hasCredentialParameter(new URLSearchParams(fragmentQuery));
}

function redactEndpointCandidate(candidate: string): string {
  let end = candidate.length;
  while (end > 0 && /[),.;\]}]/u.test(candidate[end - 1] ?? "")) end -= 1;
  const core = candidate.slice(0, end);
  const suffix = candidate.slice(end);
  if (core && hasUriCredentials(core)) return `${REDACTED}${suffix}`;
  return hasUriCredentials(candidate) ? REDACTED : candidate;
}

function stripBackupSuffixes(filename: string): string {
  let candidate = filename;
  while (candidate.endsWith("~")) candidate = candidate.slice(0, -1);

  for (;;) {
    const dotIndex = candidate.lastIndexOf(".");
    const extension = dotIndex >= 0 ? candidate.slice(dotIndex) : "";
    if (!backupSuffixes.has(extension.toLocaleLowerCase("en-US"))) return candidate;
    candidate = candidate.slice(0, dotIndex);
    while (candidate.endsWith("~")) candidate = candidate.slice(0, -1);
  }
}

export function redactCredentialText(value: string): string {
  const patternRedacted = secretValuePatterns.reduce(
    (current, pattern) => current.replace(pattern, REDACTED),
    value,
  );
  return patternRedacted
    .replace(schemeUriPattern, redactEndpointCandidate)
    .replace(protocolRelativeUriPattern, redactEndpointCandidate)
    .replace(endpointTokenPattern, redactEndpointCandidate);
}

export function containsCredentialText(value: string): boolean {
  return redactCredentialText(value) !== value || hasUriCredentials(value);
}

export function isCredentialFilename(filename: string): boolean {
  const normalized = filename.normalize("NFKC");
  const baseFilename = stripBackupSuffixes(normalized);
  if (containsCredentialText(baseFilename)) return true;
  const comparableFilename = baseFilename.toLocaleLowerCase("en-US");
  if (exactCredentialNames.has(comparableFilename)) return true;
  const dotIndex = comparableFilename.lastIndexOf(".");
  const extension = dotIndex >= 0 ? comparableFilename.slice(dotIndex) : "";
  return credentialExtensions.has(extension) || sensitiveStem.test(comparableFilename);
}
