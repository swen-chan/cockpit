import "server-only";

import { homedir } from "node:os";
import path from "node:path";

import type {
  ConversationCursorIdentity,
  ConversationIdentityCodec,
} from "@/server/adapters/conversations";
import {
  panelTokenCodec,
  type PanelTokenCodec,
  type PanelTokenScope,
} from "@/server/panels/opaque-token";
import type { HermesPanelDescriptor } from "@/server/panels/registry";
import { SourceSecurityError } from "@/server/security/errors";

type PrivateEnvironment = Readonly<Record<string, string>>;

export interface ScopedHermesSourceOptions {
  readonly environment?: PrivateEnvironment;
  readonly platformRoot?: string;
}

export interface ScopedHermesConversationOptions extends ScopedHermesSourceOptions {
  readonly identityCodec: ConversationIdentityCodec;
}

export interface ScopedHermesFilesOptions {
  readonly workspaceRoot?: string;
}

const MAX_HERMES_RAW_ID_BYTES = 200;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;

function assertFixedHermesPanel(panel: HermesPanelDescriptor): void {
  if (
    panel.id !== "hermes" ||
    panel.name !== "Hermes" ||
    panel.runtime !== "hermes" ||
    panel.adapterVersion !== "hermes-v1"
  ) {
    throw new SourceSecurityError("source_malformed");
  }
}

function tokenScope(panel: HermesPanelDescriptor): PanelTokenScope {
  assertFixedHermesPanel(panel);
  return Object.freeze({
    panelId: panel.id,
    runtime: panel.runtime,
    adapterVersion: panel.adapterVersion,
  });
}

function validRawId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= MAX_HERMES_RAW_ID_BYTES &&
    !CONTROL_CHARACTERS.test(value)
  );
}

function validTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function invalidSelector(): never {
  throw new SourceSecurityError("invalid_path");
}

function invalidSourceIdentity(): never {
  throw new SourceSecurityError("source_malformed");
}

function parseCursorPayload(value: string): ConversationCursorIdentity {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return invalidSelector();
    const keys = Object.keys(parsed);
    if (keys.length !== 2 || !Object.hasOwn(parsed, "rawId") || !Object.hasOwn(parsed, "time")) {
      return invalidSelector();
    }
    const candidate = parsed as { rawId?: unknown; time?: unknown };
    if (!validRawId(candidate.rawId) || !validTime(candidate.time)) return invalidSelector();
    return { rawId: candidate.rawId, time: candidate.time };
  } catch (error) {
    if (error instanceof SourceSecurityError) throw error;
    return invalidSelector();
  }
}

export function createScopedHermesConversationIdentityCodec(
  panel: HermesPanelDescriptor,
  tokens: PanelTokenCodec = panelTokenCodec,
): ConversationIdentityCodec {
  const scope = tokenScope(panel);
  return Object.freeze({
    encodeTask(rawId: string, time: number) {
      if (!validRawId(rawId) || !validTime(time)) return invalidSourceIdentity();
      return tokens.encodeTask(scope, rawId);
    },
    decodeTask(value: string) {
      const rawId = tokens.decodeTask(scope, value);
      return validRawId(rawId) ? rawId : invalidSelector();
    },
    encodeCursor(rawId: string, time: number) {
      if (!validRawId(rawId) || !validTime(time)) return invalidSourceIdentity();
      return tokens.encodeCursor(scope, JSON.stringify({ rawId, time }));
    },
    decodeCursor(value: string) {
      return parseCursorPayload(tokens.decodeCursor(scope, value));
    },
  });
}

function scopedConfiguration(panel: HermesPanelDescriptor) {
  assertFixedHermesPanel(panel);
  return panel.configuration.mode === "scoped" ? panel.configuration : null;
}

function scopedEnvironment(
  panel: HermesPanelDescriptor,
  options: { source: boolean; workspace: boolean },
): ScopedHermesSourceOptions {
  const configuration = scopedConfiguration(panel);
  if (!configuration) return Object.freeze({});

  const environment: Record<string, string> = {};
  if (configuration.explicitHome) environment.COCKPIT_HERMES_HOME = configuration.explicitHome;
  if (options.source) {
    if (configuration.source.kind === "preset") {
      environment.COCKPIT_SOURCE_PRESET = configuration.source.value;
    } else {
      environment.COCKPIT_SOURCE_MANIFEST = configuration.source.value;
    }
  }
  if (options.workspace) environment.COCKPIT_WORKSPACE_ROOT = configuration.workspaceRoot;

  return Object.freeze({
    environment: Object.freeze(environment),
    platformRoot: path.join(homedir(), ".hermes"),
  });
}

export function scopedHermesConversationOptions(
  panel: HermesPanelDescriptor,
  tokens: PanelTokenCodec = panelTokenCodec,
): ScopedHermesConversationOptions {
  return Object.freeze({
    ...scopedEnvironment(panel, { source: true, workspace: false }),
    identityCodec: createScopedHermesConversationIdentityCodec(panel, tokens),
  });
}

export function scopedHermesSystemOptions(panel: HermesPanelDescriptor): ScopedHermesSourceOptions {
  return scopedEnvironment(panel, { source: true, workspace: true });
}

export function scopedHermesJobsOptions(panel: HermesPanelDescriptor): ScopedHermesSourceOptions {
  return scopedEnvironment(panel, { source: true, workspace: false });
}

export function scopedHermesSkillOptions(panel: HermesPanelDescriptor): ScopedHermesSourceOptions {
  return scopedEnvironment(panel, { source: false, workspace: false });
}

export function scopedHermesFilesOptions(panel: HermesPanelDescriptor): ScopedHermesFilesOptions {
  const configuration = scopedConfiguration(panel);
  return Object.freeze(configuration ? { workspaceRoot: configuration.workspaceRoot } : {});
}
