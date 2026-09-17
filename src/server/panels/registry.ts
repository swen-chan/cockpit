import "server-only";

import path from "node:path";

import {
  agentPanelIdSchema,
  publicAgentPanelSchema,
  type AgentPanelId,
  type AgentRuntime,
  type AgentSurface,
  type PublicAgentPanel,
} from "@/contracts/agents";
import { SourceSecurityError } from "@/server/security/errors";
import { parseRelativePath } from "@/server/security/path-policy";

export type PanelMode = "legacySingleHermes" | "scopedCodexOnly" | "scopedDual";
export type PanelAdapterVersion = "hermes-v1" | "codex-0.145.0";

interface PanelBase {
  readonly id: AgentPanelId;
  readonly name: "Hermes" | "Codex";
  readonly runtime: AgentRuntime;
  readonly adapterVersion: PanelAdapterVersion;
  readonly surfaces: readonly AgentSurface[];
}

export interface HermesPanelDescriptor extends PanelBase {
  readonly id: "hermes";
  readonly name: "Hermes";
  readonly runtime: "hermes";
  readonly adapterVersion: "hermes-v1";
  readonly configuration:
    | { readonly mode: "legacy" }
    | {
        readonly mode: "scoped";
        readonly workspaceRoot: string;
        readonly source:
          | { readonly kind: "preset"; readonly value: string }
          | { readonly kind: "manifest"; readonly value: string };
        readonly explicitHome?: string;
      };
}

export interface CodexPanelDescriptor extends PanelBase {
  readonly id: "codex";
  readonly name: "Codex";
  readonly runtime: "codex";
  readonly adapterVersion: "codex-0.145.0";
  readonly configuration: {
    readonly home: string;
    readonly workspaceRoot?: string;
    readonly customGuidance?: string;
  };
}

export type AgentPanelDescriptor = HermesPanelDescriptor | CodexPanelDescriptor;

export interface PanelRegistry {
  readonly mode: PanelMode;
  readonly panels: readonly AgentPanelDescriptor[];
  readonly publicPanels: readonly PublicAgentPanel[];
  readonly defaultPanelId: AgentPanelId;
}

const HERMES_SURFACES = Object.freeze<AgentSurface[]>([
  "overview",
  "system",
  "conversations",
  "files",
  "jobs",
]);
const CODEX_SURFACES = Object.freeze<AgentSurface[]>(["overview", "system", "conversations"]);
const CODEX_FILES_SURFACES = Object.freeze<AgentSurface[]>([
  "overview",
  "system",
  "conversations",
  "files",
]);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const PRESET_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u;
const MAX_PATH_CHARACTERS = 4_096;

function configuredValue(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
  maximum = MAX_PATH_CHARACTERS,
): string | undefined {
  const raw = environment[key];
  if (raw === undefined) return undefined;
  if (raw === "") return undefined;
  if (raw.length > maximum || CONTROL_CHARACTERS.test(raw) || raw !== raw.trim()) {
    throw new SourceSecurityError("source_malformed");
  }
  return raw;
}

function absolutePath(value: string): string {
  if (!path.isAbsolute(value) || path.normalize(value) === path.parse(value).root) {
    throw new SourceSecurityError("source_malformed");
  }
  return value;
}

function manifestPath(value: string): string {
  return absolutePath(value);
}

function relativeGuidance(value: string): string {
  try {
    const segments = parseRelativePath(value);
    if (segments.length === 0) throw new Error();
    return value;
  } catch {
    throw new SourceSecurityError("source_malformed");
  }
}

function publicPanel(panel: AgentPanelDescriptor): PublicAgentPanel {
  const parsed = publicAgentPanelSchema.parse({
    id: panel.id,
    name: panel.name,
    runtime: panel.runtime,
    surfaces: [...panel.surfaces],
  });
  return Object.freeze({ ...parsed, surfaces: Object.freeze(parsed.surfaces) });
}

function legacyHermes(): HermesPanelDescriptor {
  return Object.freeze({
    id: "hermes",
    name: "Hermes",
    runtime: "hermes",
    adapterVersion: "hermes-v1",
    surfaces: HERMES_SURFACES,
    configuration: Object.freeze({ mode: "legacy" }),
  });
}

function scopedHermes(
  workspaceRoot: string,
  preset: string | undefined,
  manifest: string | undefined,
  explicitHome: string | undefined,
): HermesPanelDescriptor {
  if (Boolean(preset) === Boolean(manifest)) throw new SourceSecurityError("source_malformed");
  const source = preset
    ? { kind: "preset" as const, value: PRESET_ID.test(preset) ? preset : "" }
    : { kind: "manifest" as const, value: manifestPath(manifest ?? "") };
  if (!source.value) throw new SourceSecurityError("source_malformed");
  const configuration = Object.freeze({
    mode: "scoped" as const,
    workspaceRoot: absolutePath(workspaceRoot),
    source: Object.freeze(source),
    ...(explicitHome ? { explicitHome: absolutePath(explicitHome) } : {}),
  });
  return Object.freeze({
    id: "hermes",
    name: "Hermes",
    runtime: "hermes",
    adapterVersion: "hermes-v1",
    surfaces: HERMES_SURFACES,
    configuration,
  });
}

function codexPanel(
  home: string,
  workspaceRoot: string | undefined,
  customGuidance: string | undefined,
): CodexPanelDescriptor {
  if (customGuidance && !workspaceRoot) throw new SourceSecurityError("source_malformed");
  const configuration = Object.freeze({
    home: absolutePath(home),
    ...(workspaceRoot ? { workspaceRoot: absolutePath(workspaceRoot) } : {}),
    ...(customGuidance ? { customGuidance: relativeGuidance(customGuidance) } : {}),
  });
  return Object.freeze({
    id: "codex",
    name: "Codex",
    runtime: "codex",
    adapterVersion: "codex-0.145.0",
    surfaces: workspaceRoot ? CODEX_FILES_SURFACES : CODEX_SURFACES,
    configuration,
  });
}

export function resolvePanelRegistry(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PanelRegistry {
  const codexHome = configuredValue(environment, "COCKPIT_CODEX_HOME");
  const codexWorkspace = configuredValue(environment, "COCKPIT_CODEX_WORKSPACE_ROOT");
  const customGuidance = configuredValue(environment, "COCKPIT_CODEX_CUSTOM_GUIDANCE");
  const configuredDefault = configuredValue(environment, "COCKPIT_DEFAULT_PANEL", 16);

  if (!codexHome) {
    if (codexWorkspace || customGuidance) throw new SourceSecurityError("source_malformed");
    if (configuredDefault && configuredDefault !== "hermes")
      throw new SourceSecurityError("source_malformed");
    const hermes = legacyHermes();
    return Object.freeze({
      mode: "legacySingleHermes",
      panels: Object.freeze([hermes]),
      publicPanels: Object.freeze([publicPanel(hermes)]),
      defaultPanelId: "hermes",
    });
  }

  const hermesWorkspace = configuredValue(environment, "COCKPIT_WORKSPACE_ROOT");
  const hermesPreset = configuredValue(environment, "COCKPIT_SOURCE_PRESET", 100);
  const hermesManifest = configuredValue(environment, "COCKPIT_SOURCE_MANIFEST");
  const cockpitHermesHome = configuredValue(environment, "COCKPIT_HERMES_HOME");
  const hasHermesConfiguration = Boolean(
    hermesWorkspace || hermesPreset || hermesManifest || cockpitHermesHome,
  );
  // HERMES_HOME is an existing Hermes fallback, not a panel activation flag.
  // Capture only the selected value after Hermes is explicitly configured so
  // scoped readers can stay independent of the ambient process environment.
  const hermesHome = hasHermesConfiguration
    ? (cockpitHermesHome ?? configuredValue(environment, "HERMES_HOME"))
    : undefined;
  const panels: AgentPanelDescriptor[] = [];
  if (hasHermesConfiguration) {
    if (!hermesWorkspace) throw new SourceSecurityError("source_malformed");
    panels.push(scopedHermes(hermesWorkspace, hermesPreset, hermesManifest, hermesHome));
  }
  panels.push(codexPanel(codexHome, codexWorkspace, customGuidance));

  const requestedDefault =
    configuredDefault === undefined
      ? undefined
      : agentPanelIdSchema.safeParse(configuredDefault).data;
  if (configuredDefault && !requestedDefault) throw new SourceSecurityError("source_malformed");
  if (requestedDefault && !panels.some((panel) => panel.id === requestedDefault)) {
    throw new SourceSecurityError("source_malformed");
  }
  const defaultPanelId =
    requestedDefault ?? (panels.some((panel) => panel.id === "hermes") ? "hermes" : "codex");
  const frozenPanels = Object.freeze([...panels]);
  return Object.freeze({
    mode: hasHermesConfiguration ? "scopedDual" : "scopedCodexOnly",
    panels: frozenPanels,
    publicPanels: Object.freeze(frozenPanels.map(publicPanel)),
    defaultPanelId,
  });
}

export function resolvePanel(registry: PanelRegistry, requestedId: string): AgentPanelDescriptor {
  const parsed = agentPanelIdSchema.safeParse(requestedId);
  const panel = parsed.success
    ? registry.panels.find((candidate) => candidate.id === parsed.data)
    : undefined;
  if (!panel) throw new SourceSecurityError("invalid_panel");
  return panel;
}

export function requirePanelSurface(panel: AgentPanelDescriptor, surface: AgentSurface): void {
  if (!panel.surfaces.includes(surface)) throw new SourceSecurityError("unsupported_capability");
}

export function chooseInitialPanelId(
  registry: PanelRegistry,
  remembered: string | null | undefined,
): AgentPanelId {
  const parsed = agentPanelIdSchema.safeParse(remembered);
  return parsed.success && registry.panels.some((panel) => panel.id === parsed.data)
    ? parsed.data
    : registry.defaultPanelId;
}

export function resolveLegacyHermesPanel(registry: PanelRegistry): HermesPanelDescriptor {
  if (registry.mode !== "legacySingleHermes") throw new SourceSecurityError("panel_required");
  const panel = registry.panels[0];
  if (panel?.runtime !== "hermes") throw new SourceSecurityError("source_malformed");
  return panel;
}
