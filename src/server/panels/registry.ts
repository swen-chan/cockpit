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
import { HERMES_SOURCE_PRESET_ID } from "@/server/config/source-manifest";
import { SourceSecurityError } from "@/server/security/errors";
import { parseRelativePath } from "@/server/security/path-policy";

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
  readonly configuration: {
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
  readonly state: "ready";
  readonly panels: readonly AgentPanelDescriptor[];
  readonly publicPanels: readonly PublicAgentPanel[];
  readonly defaultPanelId: AgentPanelId;
}

const CONFIGURATION_KEYS = [
  "COCKPIT_CODEX_HOME",
  "COCKPIT_CODEX_WORKSPACE_ROOT",
  "COCKPIT_CODEX_CUSTOM_GUIDANCE",
  "COCKPIT_DEFAULT_PANEL",
  "COCKPIT_WORKSPACE_ROOT",
  "COCKPIT_SOURCE_PRESET",
  "COCKPIT_SOURCE_MANIFEST",
  "COCKPIT_HERMES_HOME",
] as const;
export type PanelConfigurationKey = (typeof CONFIGURATION_KEYS)[number] | "HERMES_HOME";
export type PanelConfigurationState =
  | { readonly state: "unconfigured" }
  | {
      readonly state: "invalid";
      readonly key: PanelConfigurationKey;
      readonly requirement: string;
    };
export type PanelRegistryResult = PanelRegistry | PanelConfigurationState;

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
const MAX_PATH_CHARACTERS = 4_096;

function invalidConfiguration(
  key: PanelConfigurationKey,
  requirement: string,
): Extract<PanelConfigurationState, { state: "invalid" }> {
  return Object.freeze({ state: "invalid", key, requirement });
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

export function resolvePanelRegistry(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PanelRegistryResult {
  const values: Partial<Record<PanelConfigurationKey, string>> = {};
  for (const key of CONFIGURATION_KEYS) {
    const raw = environment[key];
    if (raw === undefined || raw === "") continue;
    const maximum =
      key === "COCKPIT_SOURCE_PRESET"
        ? 100
        : key === "COCKPIT_DEFAULT_PANEL"
          ? 16
          : MAX_PATH_CHARACTERS;
    if (raw.length > maximum || CONTROL_CHARACTERS.test(raw) || raw !== raw.trim()) {
      return invalidConfiguration(
        key,
        `Use at most ${maximum} characters, without surrounding whitespace or control characters.`,
      );
    }
    values[key] = raw;
  }

  const codexHome = values.COCKPIT_CODEX_HOME;
  const codexWorkspace = values.COCKPIT_CODEX_WORKSPACE_ROOT;
  const customGuidance = values.COCKPIT_CODEX_CUSTOM_GUIDANCE;
  const hermesWorkspace = values.COCKPIT_WORKSPACE_ROOT;
  const hermesPreset = values.COCKPIT_SOURCE_PRESET;
  const hermesManifest = values.COCKPIT_SOURCE_MANIFEST;
  const hasHermesConfiguration = Boolean(
    hermesWorkspace || hermesPreset || hermesManifest || values.COCKPIT_HERMES_HOME,
  );
  if (hasHermesConfiguration && !values.COCKPIT_HERMES_HOME && environment.HERMES_HOME) {
    const raw = environment.HERMES_HOME;
    if (raw.length > MAX_PATH_CHARACTERS || CONTROL_CHARACTERS.test(raw) || raw !== raw.trim()) {
      return invalidConfiguration(
        "HERMES_HOME",
        "Use at most 4096 characters, without surrounding whitespace or control characters.",
      );
    }
    values.HERMES_HOME = raw;
  }
  for (const key of [
    "COCKPIT_CODEX_HOME",
    "COCKPIT_CODEX_WORKSPACE_ROOT",
    "COCKPIT_WORKSPACE_ROOT",
    "COCKPIT_SOURCE_MANIFEST",
    "COCKPIT_HERMES_HOME",
    "HERMES_HOME",
  ] as const) {
    const value = values[key];
    if (value && (!path.isAbsolute(value) || path.normalize(value) === path.parse(value).root)) {
      return invalidConfiguration(key, "Use an absolute path other than the filesystem root.");
    }
  }
  if (!codexHome && (codexWorkspace || customGuidance)) {
    return invalidConfiguration(
      "COCKPIT_CODEX_HOME",
      "Set the Codex home before configuring its workspace or guidance.",
    );
  }
  if (customGuidance && !codexWorkspace) {
    return invalidConfiguration(
      "COCKPIT_CODEX_WORKSPACE_ROOT",
      "Set an approved workspace before configuring custom guidance.",
    );
  }
  if (customGuidance) {
    try {
      if (parseRelativePath(customGuidance).length === 0) {
        return invalidConfiguration(
          "COCKPIT_CODEX_CUSTOM_GUIDANCE",
          "Use a nonempty relative file path inside the approved Codex workspace.",
        );
      }
    } catch (error) {
      if (!(error instanceof SourceSecurityError)) throw error;
      return invalidConfiguration(
        "COCKPIT_CODEX_CUSTOM_GUIDANCE",
        "Use a nonempty relative file path inside the approved Codex workspace.",
      );
    }
  }
  if (hasHermesConfiguration && !hermesWorkspace) {
    return invalidConfiguration(
      "COCKPIT_WORKSPACE_ROOT",
      "Set an approved workspace for the Hermes panel.",
    );
  }
  if (hasHermesConfiguration && Boolean(hermesPreset) === Boolean(hermesManifest)) {
    return invalidConfiguration(
      "COCKPIT_SOURCE_PRESET",
      "Set exactly one of COCKPIT_SOURCE_PRESET and COCKPIT_SOURCE_MANIFEST.",
    );
  }
  if (hermesPreset && hermesPreset !== HERMES_SOURCE_PRESET_ID) {
    return invalidConfiguration(
      "COCKPIT_SOURCE_PRESET",
      `Use ${HERMES_SOURCE_PRESET_ID}, or configure COCKPIT_SOURCE_MANIFEST instead.`,
    );
  }

  const panels: AgentPanelDescriptor[] = [];
  const hermesSource = hermesPreset
    ? { kind: "preset" as const, value: hermesPreset }
    : hermesManifest
      ? { kind: "manifest" as const, value: hermesManifest }
      : undefined;
  if (hermesWorkspace && hermesSource) {
    const explicitHome = values.COCKPIT_HERMES_HOME ?? values.HERMES_HOME;
    panels.push(
      Object.freeze({
        id: "hermes",
        name: "Hermes",
        runtime: "hermes",
        adapterVersion: "hermes-v1",
        surfaces: HERMES_SURFACES,
        configuration: Object.freeze({
          workspaceRoot: hermesWorkspace,
          source: Object.freeze(hermesSource),
          ...(explicitHome ? { explicitHome } : {}),
        }),
      }),
    );
  }
  if (codexHome) {
    panels.push(
      Object.freeze({
        id: "codex",
        name: "Codex",
        runtime: "codex",
        adapterVersion: "codex-0.145.0",
        surfaces: codexWorkspace ? CODEX_FILES_SURFACES : CODEX_SURFACES,
        configuration: Object.freeze({
          home: codexHome,
          ...(codexWorkspace ? { workspaceRoot: codexWorkspace } : {}),
          ...(customGuidance ? { customGuidance } : {}),
        }),
      }),
    );
  }
  const configuredDefault = values.COCKPIT_DEFAULT_PANEL;
  const requestedDefault = agentPanelIdSchema.safeParse(configuredDefault).data;
  if (
    configuredDefault &&
    (!requestedDefault || !panels.some((panel) => panel.id === requestedDefault))
  ) {
    return invalidConfiguration(
      "COCKPIT_DEFAULT_PANEL",
      "Choose a configured panel: hermes or codex.",
    );
  }
  const firstPanel = panels[0];
  if (!firstPanel) return Object.freeze({ state: "unconfigured" });
  const frozenPanels = Object.freeze(panels);
  return Object.freeze({
    state: "ready",
    panels: frozenPanels,
    publicPanels: Object.freeze(frozenPanels.map(publicPanel)),
    defaultPanelId: requestedDefault ?? firstPanel.id,
  });
}

export function resolvePanel(
  registry: PanelRegistryResult,
  requestedId: string,
): AgentPanelDescriptor {
  if (registry.state !== "ready") {
    throw new SourceSecurityError(
      registry.state === "unconfigured" ? "missing_source" : "source_malformed",
    );
  }
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
