import "server-only";

import { homedir } from "node:os";
import path from "node:path";
import { cache } from "react";

import type { ProfileSummary, SystemSnapshot, SystemSource } from "@/contracts/cockpit";
import { readSkillPreview, readSkillsSource, readToolsSource } from "@/server/adapters/capabilities";
import { profileConfigSystemSource } from "@/server/adapters/config-system-source";
import {
  profileSummaryWithoutConfig,
  readProfileSummary,
  unavailableProfileSummary,
} from "@/server/adapters/profile-config";
import {
  readSystemDocument,
  systemDocumentFailure,
  type SystemDocumentSpec,
} from "@/server/adapters/system-documents";
import { readSystemPrompt, unavailableSystemPrompt } from "@/server/adapters/system-prompt";
import { resolveHermesContextFromEnvironment, type HermesContext } from "@/server/config/hermes-context";
import { resolveCockpitRuntimeConfig } from "@/server/config/runtime";
import {
  resolveSourceManifest,
  type PrivateSourceManifest,
} from "@/server/config/source-manifest";
import {
  classifySourceError,
  SourceSecurityError,
  type SafeErrorCode,
} from "@/server/security/errors";

export type SystemPageData = SystemSnapshot;

export interface LoadSystemOptions {
  environment?: Readonly<Record<string, string | undefined>>;
  manifest?: PrivateSourceManifest;
  now?: Date;
  platformRoot?: string;
}

interface ResolvedSystemInputs {
  context: HermesContext | null;
  environment: Readonly<Record<string, string | undefined>>;
  manifestResult: ReturnType<typeof resolveManifest>;
  now: Date;
}

const memorySpecs = [
  {
    id: "memory",
    title: "Memory",
    category: "Durable context",
    summary: "Long-lived context retained by Hermes.",
    relativePath: "memories/MEMORY.md",
    displayPath: "<HERMES_HOME> / memories / MEMORY.md",
    sourceLabel: "Hermes memory",
  },
  {
    id: "user",
    title: "User Profile",
    category: "Durable context",
    summary: "User preferences and stable profile context.",
    relativePath: "memories/USER.md",
    displayPath: "<HERMES_HOME> / memories / USER.md",
    sourceLabel: "Hermes memory",
  },
] as const;

const workspaceSpecs = [
  {
    id: "soul",
    title: "SOUL.md",
    category: "Operating principles",
    summary: "High-level principles shaping Hermes behavior.",
    relativePath: "SOUL.md",
    displayPath: "Hermes workspace / SOUL.md",
    sourceLabel: "Approved workspace",
  },
  {
    id: "agents",
    title: "AGENTS.md",
    category: "Repository rules",
    summary: "Instructions applied inside the approved workspace.",
    relativePath: "AGENTS.md",
    displayPath: "Hermes workspace / AGENTS.md",
    sourceLabel: "Approved workspace",
  },
] as const;

function resolveManifest(
  environment: Readonly<Record<string, string | undefined>>,
  supplied: PrivateSourceManifest | undefined,
): {
  code?: SafeErrorCode;
  manifest?: PrivateSourceManifest;
  state: "ready" | "unavailable" | "error";
} {
  try {
    return { ...resolveSourceManifest(environment, supplied), state: "ready" };
  } catch (error) {
    const code = classifySourceError(error);
    return { code, state: code === "missing_source" ? "unavailable" : "error" };
  }
}

function resolveContext(
  environment: Readonly<Record<string, string | undefined>>,
  platformRoot: string,
): HermesContext | null {
  try {
    const explicitHome = environment.COCKPIT_HERMES_HOME?.trim();
    return resolveHermesContextFromEnvironment({
      platformRoot,
      environment,
      ...(explicitHome ? { explicitHome } : {}),
    });
  } catch {
    return null;
  }
}

function resolveSystemInputs(options: LoadSystemOptions): ResolvedSystemInputs {
  const environment = options.environment ?? process.env;
  const platformRoot = options.platformRoot
    ?? environment.COCKPIT_PLATFORM_HERMES_ROOT?.trim()
    ?? path.join(homedir(), ".hermes");
  return {
    context: resolveContext(environment, platformRoot),
    environment,
    manifestResult: resolveManifest(environment, options.manifest),
    now: options.now ?? new Date(),
  };
}

function documentFailure(
  spec: Omit<SystemDocumentSpec, "root">,
  state: "unavailable" | "error",
  code: string,
  now: Date,
): SystemSource {
  return systemDocumentFailure(spec, state, code, now);
}

function capabilityFailure(
  id: "skills" | "tools",
  title: string,
  summary: string,
  pathLabel: string,
  now: Date,
): SystemSource {
  return {
    id,
    title,
    category: "Capabilities",
    summary,
    content: "This capability source is not available for the resolved Hermes profile.",
    stamp: {
      id,
      label: id === "skills" ? "Hermes skills" : "Hermes configuration",
      path: pathLabel,
      observedAt: now.toISOString(),
      state: "unavailable",
    },
    metadata: [
      { label: "Status", value: "Not available" },
      { label: "Content", value: "Not sent to browser" },
    ],
  };
}

async function readCoreSystemSources({
  context,
  environment,
  manifestResult,
  now,
}: ResolvedSystemInputs): Promise<SystemSource[]> {
  const prompt = context && manifestResult.manifest
    ? await readSystemPrompt(context, manifestResult.manifest.conversation, now)
    : unavailableSystemPrompt(
      manifestResult.state === "error" ? "error" : "unavailable",
      context ? manifestResult.code ?? "source_manifest_unavailable" : "profile_unavailable",
      now,
    );

  const memory = context
    ? await Promise.all(memorySpecs.map((spec) => readSystemDocument({ ...spec, root: context.home }, now)))
    : memorySpecs.map((spec) => documentFailure(spec, "unavailable", "profile_unavailable", now));

  let workspaceRoot: string | null = null;
  try {
    workspaceRoot = resolveCockpitRuntimeConfig(environment).workspaceRoot;
  } catch {}
  const workspace = workspaceRoot
    ? await Promise.all(workspaceSpecs.map((spec) => readSystemDocument({ ...spec, root: workspaceRoot! }, now)))
    : workspaceSpecs.map((spec) => documentFailure(spec, "unavailable", "workspace_unavailable", now));

  return [prompt, ...memory, ...workspace];
}

export async function loadProfileFromEnvironment(options: LoadSystemOptions = {}): Promise<ProfileSummary> {
  const environment = options.environment ?? process.env;
  const platformRoot = options.platformRoot
    ?? environment.COCKPIT_PLATFORM_HERMES_ROOT?.trim()
    ?? path.join(homedir(), ".hermes");
  const context = resolveContext(environment, platformRoot);
  if (!context) return unavailableProfileSummary();
  const manifestResult = resolveManifest(environment, options.manifest);
  if (!manifestResult.manifest) {
    return profileSummaryWithoutConfig(context, manifestResult.state === "error" ? "error" : "unavailable");
  }
  return readProfileSummary(context, manifestResult.manifest.configRelativePath);
}

export const loadProfileForRequest = cache(() => loadProfileFromEnvironment());

export async function loadCoreSystemSources(options: LoadSystemOptions = {}): Promise<SystemSource[]> {
  return readCoreSystemSources(resolveSystemInputs(options));
}

export async function loadSystemPageData(options: LoadSystemOptions = {}): Promise<SystemPageData> {
  const inputs = resolveSystemInputs(options);
  const { context, manifestResult, now } = inputs;
  const profile = context
    ? manifestResult.manifest
      ? await readProfileSummary(context, manifestResult.manifest.configRelativePath)
      : profileSummaryWithoutConfig(context, manifestResult.state === "error" ? "error" : "unavailable")
    : unavailableProfileSummary();

  const coreSources = await readCoreSystemSources(inputs);

  const capabilities = context && manifestResult.manifest
    ? await Promise.all([
      readSkillsSource(context, manifestResult.manifest.configRelativePath, now),
      readToolsSource(context, manifestResult.manifest.configRelativePath, now),
    ])
    : [
      capabilityFailure(
        "skills",
        "Skills",
        "Installed skill manifests visible to Hermes.",
        "<HERMES_HOME> / skills",
        now,
      ),
      capabilityFailure(
        "tools",
        "Tools",
        "Effective Hermes toolsets for the active CLI profile.",
        "<HERMES_HOME> / <SAFE_CONFIG_SOURCE> / platform_toolsets",
        now,
      ),
    ];

  return {
    profile,
    sources: [...coreSources, ...capabilities, profileConfigSystemSource(profile, now)],
  };
}

export async function loadSkillPreview(
  requestedId: string,
  options: LoadSystemOptions = {},
): Promise<SystemSource> {
  const environment = options.environment ?? process.env;
  const platformRoot = options.platformRoot
    ?? environment.COCKPIT_PLATFORM_HERMES_ROOT?.trim()
    ?? path.join(homedir(), ".hermes");
  const context = resolveContext(environment, platformRoot);
  if (!context) throw new SourceSecurityError("invalid_profile");
  return readSkillPreview(context, requestedId, options.now ?? new Date());
}
