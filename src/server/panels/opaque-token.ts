import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { AgentPanelId, AgentRuntime } from "@/contracts/agents";
import type { PanelAdapterVersion } from "@/server/panels/registry";
import { SourceSecurityError } from "@/server/security/errors";

export interface PanelTokenScope {
  readonly panelId: AgentPanelId;
  readonly runtime: AgentRuntime;
  readonly adapterVersion: PanelAdapterVersion;
}

export interface PanelTokenCodec {
  encodeTask(scope: PanelTokenScope, rawId: string): string;
  decodeTask(scope: PanelTokenScope, token: string): string;
  encodeCursor(scope: PanelTokenScope, rawCursor: string): string;
  decodeCursor(scope: PanelTokenScope, token: string): string;
}

type TokenKind = "task" | "cursor";

const NAMESPACE = "cockpit-v0.2";
const TOKEN_VERSION = 1;
const TOKEN_PATTERN = /^(?:task|cursor)-[A-Za-z0-9_-]+$/u;
const MAX_TOKEN_CHARACTERS = 6_000;
const CURSOR_RAW_BYTES = 4_096;
const HERMES_TASK_RAW_BYTES = 200;
const CODEX_TASK_RAW_BYTES = 128;
const PROCESS_SECRET = Symbol.for("cockpit.panel-token-secret.v1");

function tokenGlobals(): typeof globalThis & Record<PropertyKey, unknown> {
  return globalThis as typeof globalThis & Record<PropertyKey, unknown>;
}

export function initializePanelTokenSecret(): void {
  const globals = tokenGlobals();
  const existing = globals[PROCESS_SECRET];
  if (existing !== undefined) {
    if (!Buffer.isBuffer(existing) || existing.byteLength !== 32) {
      throw new SourceSecurityError("source_unavailable");
    }
    return;
  }
  Object.defineProperty(globals, PROCESS_SECRET, {
    configurable: false,
    enumerable: false,
    value: randomBytes(32),
    writable: false,
  });
}

function processTokenSecret(): Uint8Array {
  initializePanelTokenSecret();
  const secret = tokenGlobals()[PROCESS_SECRET];
  if (!Buffer.isBuffer(secret) || secret.byteLength !== 32) {
    throw new SourceSecurityError("source_unavailable");
  }
  return secret;
}

function reject(): never {
  throw new SourceSecurityError("invalid_path");
}

function validScope(scope: PanelTokenScope): boolean {
  return (
    scope.panelId === scope.runtime &&
    ((scope.runtime === "hermes" && scope.adapterVersion === "hermes-v1") ||
      (scope.runtime === "codex" && scope.adapterVersion === "codex-0.145.0"))
  );
}

function associatedData(kind: TokenKind, scope: PanelTokenScope): Buffer {
  if (!validScope(scope)) return reject();
  return Buffer.from(
    JSON.stringify([NAMESPACE, kind, scope.panelId, scope.runtime, scope.adapterVersion]),
    "utf8",
  );
}

function rawLimit(kind: TokenKind, scope: PanelTokenScope): number {
  if (!validScope(scope)) return reject();
  if (kind === "cursor") return CURSOR_RAW_BYTES;
  return scope.runtime === "codex" ? CODEX_TASK_RAW_BYTES : HERMES_TASK_RAW_BYTES;
}

function validateRaw(kind: TokenKind, scope: PanelTokenScope, value: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    Buffer.byteLength(value, "utf8") > rawLimit(kind, scope) ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  )
    return reject();
  return value;
}

export function createPanelTokenCodec(secret: Uint8Array = randomBytes(32)): PanelTokenCodec {
  if (secret.byteLength !== 32) throw new TypeError("Panel token key must be 32 bytes.");
  const key = Buffer.from(secret);

  function encode(kind: TokenKind, scope: PanelTokenScope, rawValue: string): string {
    const value = validateRaw(kind, scope, rawValue);
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, initializationVector);
    cipher.setAAD(associatedData(kind, scope));
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify({ version: TOKEN_VERSION, value }), "utf8"),
      cipher.final(),
    ]);
    const token = `${kind}-${Buffer.concat([initializationVector, cipher.getAuthTag(), encrypted]).toString("base64url")}`;
    if (token.length > MAX_TOKEN_CHARACTERS) return reject();
    return token;
  }

  function decode(kind: TokenKind, scope: PanelTokenScope, token: string): string {
    const marker = `${kind}-`;
    if (
      typeof token !== "string" ||
      token.length <= marker.length ||
      token.length > MAX_TOKEN_CHARACTERS ||
      !TOKEN_PATTERN.test(token) ||
      !token.startsWith(marker)
    )
      return reject();
    try {
      const encoded = token.slice(marker.length);
      const bytes = Buffer.from(encoded, "base64url");
      if (bytes.toString("base64url") !== encoded) return reject();
      if (bytes.length < 30) return reject();
      const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      decipher.setAAD(associatedData(kind, scope));
      decipher.setAuthTag(bytes.subarray(12, 28));
      const plaintext = Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString("utf8");
      const parsed: unknown = JSON.parse(plaintext);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed) ||
        Object.keys(parsed).length !== 2 ||
        !("version" in parsed) ||
        !("value" in parsed) ||
        parsed.version !== TOKEN_VERSION ||
        typeof parsed.value !== "string"
      )
        return reject();
      return validateRaw(kind, scope, parsed.value);
    } catch (error) {
      if (error instanceof SourceSecurityError) throw error;
      return reject();
    }
  }

  return Object.freeze({
    encodeTask: (scope: PanelTokenScope, rawId: string) => encode("task", scope, rawId),
    decodeTask: (scope: PanelTokenScope, token: string) => decode("task", scope, token),
    encodeCursor: (scope: PanelTokenScope, rawCursor: string) => encode("cursor", scope, rawCursor),
    decodeCursor: (scope: PanelTokenScope, token: string) => decode("cursor", scope, token),
  });
}

let sharedCodec: PanelTokenCodec | undefined;

function processTokenCodec(): PanelTokenCodec {
  sharedCodec ??= createPanelTokenCodec(processTokenSecret());
  return sharedCodec;
}

export const panelTokenCodec: PanelTokenCodec = Object.freeze({
  encodeTask: (scope: PanelTokenScope, rawId: string) =>
    processTokenCodec().encodeTask(scope, rawId),
  decodeTask: (scope: PanelTokenScope, token: string) =>
    processTokenCodec().decodeTask(scope, token),
  encodeCursor: (scope: PanelTokenScope, rawCursor: string) =>
    processTokenCodec().encodeCursor(scope, rawCursor),
  decodeCursor: (scope: PanelTokenScope, token: string) =>
    processTokenCodec().decodeCursor(scope, token),
});
