import "server-only";

import path from "node:path";
import { z } from "zod";

import {
  agentPanelIdSchema,
  claudeProjectIdSchema,
  publicAgentPanelSchema,
  type AgentPanelId,
  type AgentRuntime,
  type AgentSurface,
  type PublicAgentPanel,
} from "@/contracts/agents";
import { HERMES_SOURCE_PRESET_ID } from "@/server/config/source-manifest";
import { SourceSecurityError } from "@/server/security/errors";
import { parseRelativePath } from "@/server/security/path-policy";
import { cleanBrowserText, isWellFormedUnicode } from "@/server/security/safe-text";

export type PanelAdapterVersion = "hermes-v1" | "codex-0.145.0" | "claude-sdk-0.3.283";

interface PanelBase {
  readonly id: AgentPanelId;
  readonly name: "Hermes" | "Codex" | "Claude Code";
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

export interface ClaudeProjectDescriptor {
  readonly id: string;
  readonly name: string;
  readonly sessionRoot: string;
  readonly workspaceRoot: string;
  readonly memoryRoot?: string;
}

export interface ClaudePanelDescriptor extends PanelBase {
  readonly id: "claude-code";
  readonly name: "Claude Code";
  readonly runtime: "claude-code";
  readonly adapterVersion: "claude-sdk-0.3.283";
  readonly configuration: {
    readonly projects: readonly ClaudeProjectDescriptor[];
    readonly userRoot?: string;
  };
}

export type AgentPanelDescriptor =
  HermesPanelDescriptor | CodexPanelDescriptor | ClaudePanelDescriptor;

export interface PanelRegistry {
  readonly state: "ready";
  readonly panels: readonly AgentPanelDescriptor[];
  readonly publicPanels: readonly PublicAgentPanel[];
  readonly defaultPanelId: AgentPanelId;
}

const CONFIGURATION_KEYS = [
  "COCKPIT_CLAUDE_SESSION_ROOT",
  "COCKPIT_CLAUDE_PROJECTS",
  "COCKPIT_CLAUDE_USER_ROOT",
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
const MAX_CLAUDE_CONFIGURATION_BYTES = 200 * 1_024;

const claudeRootSchema = z
  .string()
  .min(1)
  .max(MAX_PATH_CHARACTERS)
  .refine(
    (value) =>
      isWellFormedUnicode(value) &&
      !CONTROL_CHARACTERS.test(value) &&
      value === value.trim() &&
      path.isAbsolute(value) &&
      path.normalize(value) !== path.parse(value).root,
  );
const claudeProjectsSchema = z
  .array(
    z
      .object({
        id: claudeProjectIdSchema.refine((value) => cleanBrowserText(value).text === value),
        name: z
          .string()
          .min(1)
          .max(80)
          .refine(
            (value) => !CONTROL_CHARACTERS.test(value) && cleanBrowserText(value).text === value,
          ),
        sessionRoot: claudeRootSchema,
        workspaceRoot: claudeRootSchema,
        memoryRoot: claudeRootSchema.optional(),
      })
      .strict(),
  )
  .min(1)
  .max(12)
  .refine((projects) => new Set(projects.map(({ id }) => id)).size === projects.length);

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
  if (environment.COCKPIT_CLAUDE_SESSION_ROOT) {
    return invalidConfiguration(
      "COCKPIT_CLAUDE_SESSION_ROOT",
      "Remove COCKPIT_CLAUDE_SESSION_ROOT and configure COCKPIT_CLAUDE_PROJECTS instead.",
    );
  }
  const values: Partial<Record<PanelConfigurationKey, string>> = {};
  for (const key of CONFIGURATION_KEYS) {
    const raw = environment[key];
    if (raw === undefined || raw === "") continue;
    if (key === "COCKPIT_CLAUDE_PROJECTS") {
      if (Buffer.byteLength(raw, "utf8") > MAX_CLAUDE_CONFIGURATION_BYTES) {
        return invalidConfiguration(key, "Use at most 200 KiB of project configuration JSON.");
      }
      values[key] = raw;
      continue;
    }
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

  let claudeProjects: readonly ClaudeProjectDescriptor[] | undefined;
  if (values.COCKPIT_CLAUDE_PROJECTS) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(values.COCKPIT_CLAUDE_PROJECTS);
    } catch {
      return invalidConfiguration(
        "COCKPIT_CLAUDE_PROJECTS",
        "Use valid project configuration JSON.",
      );
    }
    const parsed = claudeProjectsSchema.safeParse(decoded);
    if (!parsed.success) {
      return invalidConfiguration(
        "COCKPIT_CLAUDE_PROJECTS",
        "Set 1–12 projects with unique short lowercase ids, safe names, absolute sessionRoot and workspaceRoot paths, and an optional absolute memoryRoot. Filesystem roots are not allowed.",
      );
    }
    claudeProjects = Object.freeze(
      parsed.data.map(({ memoryRoot, ...project }) =>
        Object.freeze({ ...project, ...(memoryRoot !== undefined ? { memoryRoot } : {}) }),
      ),
    );
  }
  if (values.COCKPIT_CLAUDE_USER_ROOT && !claudeProjects) {
    return invalidConfiguration(
      "COCKPIT_CLAUDE_PROJECTS",
      "Configure Claude projects before setting COCKPIT_CLAUDE_USER_ROOT.",
    );
  }
  if (
    values.COCKPIT_CLAUDE_USER_ROOT &&
    !claudeRootSchema.safeParse(values.COCKPIT_CLAUDE_USER_ROOT).success
  ) {
    return invalidConfiguration(
      "COCKPIT_CLAUDE_USER_ROOT",
      "Use an absolute path other than the filesystem root.",
    );
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
  if (claudeProjects) {
    panels.push(
      Object.freeze({
        id: "claude-code",
        name: "Claude Code",
        runtime: "claude-code",
        adapterVersion: "claude-sdk-0.3.283",
        surfaces: Object.freeze<AgentSurface[]>(["conversations", "overview", "system", "files"]),
        configuration: Object.freeze({
          projects: claudeProjects,
          ...(values.COCKPIT_CLAUDE_USER_ROOT ? { userRoot: values.COCKPIT_CLAUDE_USER_ROOT } : {}),
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
      "Choose a configured panel: hermes, codex, or claude-code.",
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
