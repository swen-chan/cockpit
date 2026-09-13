import "server-only";

import { containsSecrets } from "@/server/security/redaction";

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

const credentialExtensions = new Set([".pem", ".key", ".ppk", ".p8", ".pk8", ".p12", ".pfx", ".jks", ".keystore"]);
const backupSuffixes = new Set([".bak", ".backup", ".copy", ".old", ".orig", ".save"]);
const sensitiveStem = /(?:^|[._-])(api[-_]?keys?|auth|credentials?|oauth|private[-_]?keys?|secrets?|tokens?)(?:[._-]|$)/iu;

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

export function isDotPathSegment(segment: string): boolean {
  return segment.startsWith(".");
}

export function isCredentialFilename(filename: string): boolean {
  const normalized = filename.normalize("NFKC");
  const baseFilename = stripBackupSuffixes(normalized);
  if (containsSecrets(baseFilename)) return true;
  const comparableFilename = baseFilename.toLocaleLowerCase("en-US");
  if (exactCredentialNames.has(comparableFilename)) return true;
  const dotIndex = comparableFilename.lastIndexOf(".");
  const extension = dotIndex >= 0 ? comparableFilename.slice(dotIndex) : "";
  return credentialExtensions.has(extension) || sensitiveStem.test(comparableFilename);
}

export function hasExcludedSegment(segments: string[]): boolean {
  return segments.some((segment) => isDotPathSegment(segment) || isCredentialFilename(segment));
}
