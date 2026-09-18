import "server-only";

import { containsCredentialText } from "@/lib/browser-safety";
import { redactBrowserText } from "@/server/security/redaction";

const BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const FILE_URI = /(?<![A-Za-z0-9])file:(?:\/\/)?[^\r\n<>'"`]+/giu;
const UNIX_HOME_PATH = /(?<![<A-Za-z0-9:])\/(?:Users|home)\/[^\r\n<>'"`]+/gu;
const ROOT_HOME_PATH = /(?<![<A-Za-z0-9])\/root(?:\/[^\r\n<>'"`]*)?/gu;
const WINDOWS_DRIVE_PATH = /(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\r\n<>'"`]*/gu;
const WINDOWS_OR_UNIX_UNC_PATH = /(?<![:A-Za-z0-9])(?:\\\\|\/\/)[^\\/\s<>'"`]+[\\/][^\r\n<>'"`]*/gu;
const HTML_WRAPPED_MULTI_SEGMENT_PATH = /(?<=<)\/(?=[^\r\n<>'"`]*\/)[^\r\n<>'"`]+/gu;
const REPEATED_POSIX_ABSOLUTE_PATH = /(?<![</A-Za-z0-9])\/{3,}[^\r\n<>'"`]+/gu;
const POSIX_ABSOLUTE_PATH = /(?<![</A-Za-z0-9])\/(?!\/)[^\r\n<>'"`]+/gu;

export interface BrowserCleanedText {
  readonly text: string | null;
  readonly policyChanged: boolean;
}

export interface CleanBrowserTextOptions {
  readonly literalPaths?: readonly (string | undefined)[];
  readonly trim?: boolean;
}

export function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function consumeCsi(value: string, start: number): number {
  for (let index = start; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0x40 && unit <= 0x7e) return index + 1;
  }
  return value.length;
}

function consumeControlString(value: string, start: number, bellTerminates: boolean): number {
  for (let index = start; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if ((bellTerminates && unit === 0x07) || unit === 0x9c) return index + 1;
    if (unit === 0x1b && value.charCodeAt(index + 1) === 0x5c) return index + 2;
  }
  return value.length;
}

function consumeEscape(value: string, start: number): number {
  let index = start;
  while (index < value.length) {
    const unit = value.charCodeAt(index);
    if (unit >= 0x20 && unit <= 0x2f) {
      index += 1;
      continue;
    }
    return unit >= 0x30 && unit <= 0x7e ? index + 1 : index;
  }
  return value.length;
}

function stripTerminalAndDirectionControls(value: string): string {
  let output = "";
  for (let index = 0; index < value.length;) {
    const unit = value.charCodeAt(index);
    if (unit === 0x1b) {
      const next = value.charCodeAt(index + 1);
      if (next === 0x5b) index = consumeCsi(value, index + 2);
      else if (next === 0x5d) index = consumeControlString(value, index + 2, true);
      else if (next === 0x50 || next === 0x58 || next === 0x5e || next === 0x5f) {
        index = consumeControlString(value, index + 2, false);
      } else {
        index = consumeEscape(value, index + 1);
      }
      continue;
    }
    if (unit === 0x9b) {
      index = consumeCsi(value, index + 1);
      continue;
    }
    if (unit === 0x90 || unit === 0x98 || unit === 0x9d || unit === 0x9e || unit === 0x9f) {
      index = consumeControlString(value, index + 1, unit === 0x9d);
      continue;
    }
    const character = value[index] ?? "";
    if (unit === 0x09 || unit === 0x0a) output += character;
    else if (unit <= 0x1f || (unit >= 0x7f && unit <= 0x9f) || BIDI_CONTROLS.test(character)) {
      // Drop terminal controls and direction-changing formatting characters.
    } else {
      output += character;
    }
    index += 1;
  }
  return output;
}

function trimTrailingSeparators(value: string): string {
  let end = value.length;
  while (end > 1 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}

function replaceLiteralPath(value: string, candidate: string | undefined): string {
  if (!candidate || !isWellFormedUnicode(candidate)) return value;
  const normalized = trimTrailingSeparators(candidate);
  if (normalized === "/" || !normalized.startsWith("/")) return value;
  return value.split(normalized).join("<local-path>");
}

function redactAdditionalMachinePaths(
  value: string,
  literalPaths: readonly (string | undefined)[],
): string {
  let redacted = value
    // Preserve complete one-segment closing tags such as </script>, while an
    // HTML-like wrapper cannot hide a multi-segment machine path.
    .replace(HTML_WRAPPED_MULTI_SEGMENT_PATH, "local-path")
    .replace(FILE_URI, "<local-path>")
    .replace(UNIX_HOME_PATH, "<local-path>")
    .replace(ROOT_HOME_PATH, "<local-path>")
    .replace(WINDOWS_DRIVE_PATH, "<local-path>")
    .replace(WINDOWS_OR_UNIX_UNC_PATH, "<local-path>")
    .replace(REPEATED_POSIX_ABSOLUTE_PATH, "<local-path>")
    .replace(POSIX_ABSOLUTE_PATH, "<local-path>");
  for (const candidate of literalPaths) redacted = replaceLiteralPath(redacted, candidate);
  return redacted;
}

export function cleanBrowserText(
  value: string,
  options: CleanBrowserTextOptions = {},
): BrowserCleanedText {
  if (!isWellFormedUnicode(value)) return { text: null, policyChanged: true };
  const normalized = value.replace(/\r\n?/gu, "\n");
  const controlsRemoved = stripTerminalAndDirectionControls(normalized);
  const pathRedacted = redactAdditionalMachinePaths(controlsRemoved, options.literalPaths ?? []);
  const browserRedacted = redactBrowserText(pathRedacted);
  const residualCredential = containsCredentialText(browserRedacted);
  const redacted = residualCredential ? "[REDACTED]" : browserRedacted;
  const text = options.trim === false ? redacted : redacted.trim();
  return {
    text: options.trim === false ? text : text || null,
    policyChanged:
      controlsRemoved !== normalized ||
      pathRedacted !== controlsRemoved ||
      browserRedacted !== pathRedacted ||
      residualCredential,
  };
}
