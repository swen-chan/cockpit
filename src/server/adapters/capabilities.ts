import "server-only";

import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { parse } from "yaml";

import type { SystemCollectionItem, SystemSource } from "@/contracts/cockpit";
import {
  asRecord,
  formatByteCount,
  safeIdentifier,
  sourceStateForCode,
} from "@/server/adapters/safe-values";
import type { HermesContext } from "@/server/config/hermes-context";
import { readNamedTextSource } from "@/server/files/bounded-text";
import { hasExcludedSegment } from "@/server/security/credentials";
import { classifySourceError, SourceSecurityError } from "@/server/security/errors";
import { SOURCE_LIMITS } from "@/server/security/limits";
import { canonicalizeDirectory } from "@/server/security/path-policy";
import { redactBrowserText } from "@/server/security/redaction";

const maxFrontmatterBytes = 16 * 1_024;
const maxSkillDepth = 5;
const maxInspectedDirectories = SOURCE_LIMITS.maxCollectionRecords * 4;
const skillIdPattern = /^skill-[a-f0-9]{24}$/u;

interface ParsedCapabilityConfig {
  root: Record<string, unknown>;
  modifiedAt: string;
}

interface DiscoveredSkill {
  item: SystemCollectionItem;
  manifestRelativePath: string;
}

function safeStringSet(value: unknown, maxLength = 100): Set<string> {
  const candidates = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  const output = new Set<string>();
  for (const candidate of candidates) {
    const safe = safeIdentifier(candidate, maxLength);
    if (safe) output.add(safe);
  }
  return output;
}

async function readCapabilityConfig(
  context: HermesContext,
  configRelativePath: string,
): Promise<ParsedCapabilityConfig> {
  const source = await readNamedTextSource(context.home, configRelativePath, {
    rejectOversized: true,
  });
  let parsed: unknown;
  try {
    parsed = parse(source.text, { maxAliasCount: 20, uniqueKeys: true });
  } catch {
    throw new SourceSecurityError("source_malformed");
  }
  const root = asRecord(parsed);
  if (!root) throw new SourceSecurityError("source_malformed");
  return { root, modifiedAt: source.modifiedAt };
}

function parseSkillFrontmatter(text: string): Record<string, unknown> {
  const match = /^---[\t ]*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text);
  if (!match?.[1]) throw new SourceSecurityError("source_malformed");
  let parsed: unknown;
  try {
    parsed = parse(match[1], { maxAliasCount: 10, uniqueKeys: true });
  } catch {
    throw new SourceSecurityError("source_malformed");
  }
  const frontmatter = asRecord(parsed);
  if (!frontmatter) throw new SourceSecurityError("source_malformed");
  return frontmatter;
}

function skillId(relativePath: string): string {
  return `skill-${createHash("sha256").update(relativePath).digest("hex").slice(0, 24)}`;
}

function skillCategory(frontmatter: Record<string, unknown>, segments: string[]): string {
  const metadata = asRecord(frontmatter.metadata);
  const hermes = asRecord(metadata?.hermes);
  return (
    safeIdentifier(hermes?.category, 100) ??
    safeIdentifier(segments.length > 2 ? segments[0] : "uncategorized", 100) ??
    "uncategorized"
  );
}

async function discoverSkills(
  context: HermesContext,
  disabled: ReadonlySet<string>,
  configAvailable: boolean,
): Promise<{ skills: DiscoveredSkill[]; truncated: boolean }> {
  const skillsRoot = canonicalizeDirectory(path.join(context.home, "skills"));
  const pending: Array<{ absolutePath: string; segments: string[] }> = [
    { absolutePath: skillsRoot, segments: [] },
  ];
  const skills: DiscoveredSkill[] = [];
  let inspectedDirectories = 0;
  let truncated = false;

  while (pending.length > 0) {
    if (
      inspectedDirectories >= maxInspectedDirectories ||
      skills.length >= SOURCE_LIMITS.maxCollectionRecords
    ) {
      truncated = true;
      break;
    }
    const current = pending.pop();
    if (!current) break;
    inspectedDirectories += 1;
    const entries = (await readdir(current.absolutePath, { withFileTypes: true }))
      .filter((entry) => !hasExcludedSegment([entry.name]))
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
    const manifest = entries.find((entry) => entry.name === "SKILL.md" && entry.isFile());

    if (manifest && current.segments.length > 0) {
      const manifestRelativePath = [...current.segments, "SKILL.md"].join("/");
      const fallbackName = safeIdentifier(current.segments.at(-1), 100) ?? "Unnamed skill";
      try {
        const source = await readNamedTextSource(context.home, `skills/${manifestRelativePath}`, {
          maxBytes: maxFrontmatterBytes,
          maxCharacters: maxFrontmatterBytes,
        });
        const frontmatter = parseSkillFrontmatter(source.text);
        const name = safeIdentifier(frontmatter.name, 100) ?? fallbackName;
        const description = safeIdentifier(frontmatter.description, 500);
        if (!description) throw new SourceSecurityError("source_malformed");
        skills.push({
          manifestRelativePath,
          item: {
            id: skillId(manifestRelativePath),
            name,
            description,
            category: skillCategory(frontmatter, [...current.segments, "SKILL.md"]),
            status: configAvailable ? (disabled.has(name) ? "disabled" : "enabled") : "available",
            path: manifestRelativePath,
            modifiedAt: source.modifiedAt,
            previewable: true,
          },
        });
      } catch {
        skills.push({
          manifestRelativePath,
          item: {
            id: skillId(manifestRelativePath),
            name: fallbackName,
            description: "Manifest metadata could not be read safely.",
            category: "unavailable",
            status: "error",
            path: manifestRelativePath,
          },
        });
      }
      continue;
    }

    if (current.segments.length >= maxSkillDepth) {
      if (entries.some((entry) => entry.isDirectory())) truncated = true;
      continue;
    }
    for (const entry of entries.toReversed()) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      pending.push({
        absolutePath: path.join(current.absolutePath, entry.name),
        segments: [...current.segments, entry.name],
      });
    }
  }

  skills.sort((left, right) => left.item.name.localeCompare(right.item.name, "en"));
  return { skills, truncated };
}

function skillsFailure(state: "unavailable" | "error", code: string, now: Date): SystemSource {
  return {
    id: "skills",
    title: "Skills",
    category: "Capabilities",
    summary: "Installed skill manifests visible to Hermes.",
    content:
      state === "unavailable"
        ? "No installed skill source is available for the resolved profile."
        : "Cockpit could not safely inspect installed skill manifests.",
    stamp: {
      id: "skills",
      label: "Hermes skills",
      path: "<HERMES_HOME> / skills",
      observedAt: now.toISOString(),
      state,
    },
    metadata: [
      { label: "Status", value: state === "unavailable" ? "Not available" : "Read failed" },
      { label: "Diagnostic", value: code, mono: true },
      { label: "Bodies", value: "Not sent to browser" },
    ],
  };
}

export async function readSkillsSource(
  context: HermesContext,
  configRelativePath: string,
  now: Date = new Date(),
): Promise<SystemSource> {
  let disabled = new Set<string>();
  let configAvailable = false;
  let configDiagnostic = "ready";
  try {
    const { root } = await readCapabilityConfig(context, configRelativePath);
    const skills = asRecord(root.skills);
    const platformDisabled = asRecord(skills?.platform_disabled);
    disabled = new Set([
      ...safeStringSet(skills?.disabled),
      ...safeStringSet(platformDisabled?.cli),
    ]);
    configAvailable = true;
  } catch (error) {
    configDiagnostic = classifySourceError(error);
  }

  try {
    const discovered = await discoverSkills(context, disabled, configAvailable);
    const items = discovered.skills.map((skill) => skill.item);
    const enabled = items.filter((item) => item.status === "enabled").length;
    const disabledCount = items.filter((item) => item.status === "disabled").length;
    return {
      id: "skills",
      title: "Skills",
      category: "Capabilities",
      summary: "Installed skills with safe metadata; instructions load only when selected.",
      content: `${items.length} installed skill manifests discovered.`,
      stamp: {
        id: "skills",
        label: "Hermes skills",
        path: "<HERMES_HOME> / skills",
        observedAt: now.toISOString(),
        state: "ready",
        ...(discovered.truncated ? { truncated: true } : {}),
      },
      metadata: [
        { label: "Manifests", value: String(items.length), mono: true },
        {
          label: "Enabled",
          value: configAvailable ? String(enabled) : "Status unavailable",
          mono: true,
        },
        {
          label: "Disabled",
          value: configAvailable ? String(disabledCount) : "Status unavailable",
          mono: true,
        },
        { label: "Config", value: configDiagnostic, mono: true },
      ],
      collection: { kind: "skills", items },
    };
  } catch (error) {
    const code = classifySourceError(error);
    return skillsFailure(sourceStateForCode(code), code, now);
  }
}

function toolsFailure(state: "unavailable" | "error", code: string, now: Date): SystemSource {
  return {
    id: "tools",
    title: "Tools",
    category: "Capabilities",
    summary: "Effective Hermes toolsets for the active CLI profile.",
    content:
      state === "unavailable"
        ? "No toolset configuration is available for the resolved profile."
        : "Cockpit could not safely interpret the toolset configuration.",
    stamp: {
      id: "tools",
      label: "Hermes configuration",
      path: "<HERMES_HOME> / <SAFE_CONFIG_SOURCE> / platform_toolsets",
      observedAt: now.toISOString(),
      state,
    },
    metadata: [
      { label: "Status", value: state === "unavailable" ? "Not available" : "Read failed" },
      { label: "Diagnostic", value: code, mono: true },
      { label: "Secrets", value: "Not sent to browser" },
    ],
  };
}

export async function readToolsSource(
  context: HermesContext,
  configRelativePath: string,
  now: Date = new Date(),
): Promise<SystemSource> {
  try {
    const { root, modifiedAt } = await readCapabilityConfig(context, configRelativePath);
    const platformToolsets = asRecord(root.platform_toolsets);
    const knownBuiltin = asRecord(root.known_builtin_toolsets);
    const knownPlugin = asRecord(root.known_plugin_toolsets);
    const agent = asRecord(root.agent);
    const configured = safeStringSet(platformToolsets?.cli);
    const builtin = safeStringSet(knownBuiltin?.cli);
    const plugins = safeStringSet(knownPlugin?.cli);
    const globallyDisabled = safeStringSet(agent?.disabled_toolsets);
    const hasExplicitCliConfig = Array.isArray(platformToolsets?.cli);
    const names = [...new Set([...builtin, ...plugins, ...configured, ...globallyDisabled])].sort(
      (left, right) => left.localeCompare(right, "en"),
    );
    const truncated = names.length > SOURCE_LIMITS.maxCollectionRecords;
    const items: SystemCollectionItem[] = names
      .slice(0, SOURCE_LIMITS.maxCollectionRecords)
      .map((name) => {
        const status =
          globallyDisabled.has(name) || (hasExplicitCliConfig && !configured.has(name))
            ? "disabled"
            : configured.has(name)
              ? "enabled"
              : "available";
        const description = globallyDisabled.has(name)
          ? "Disabled by agent.disabled_toolsets."
          : configured.has(name)
            ? "Enabled by platform_toolsets.cli."
            : hasExplicitCliConfig
              ? "Known to Hermes but not enabled in platform_toolsets.cli."
              : "Known to Hermes; CLI status inherits the platform default.";
        return {
          id: `toolset-${createHash("sha256").update(name).digest("hex").slice(0, 24)}`,
          name,
          description,
          category: plugins.has(name) ? "Plugin" : builtin.has(name) ? "Built-in" : "Configured",
          status,
        };
      });
    const enabled = items.filter((item) => item.status === "enabled").length;
    const disabled = items.filter((item) => item.status === "disabled").length;
    return {
      id: "tools",
      title: "Tools",
      category: "Capabilities",
      summary: "CLI toolsets derived only from allowlisted Hermes configuration fields.",
      content: `${items.length} observable toolsets found in the safe configuration summary.`,
      stamp: {
        id: "tools",
        label: "Hermes configuration",
        path: "<HERMES_HOME> / <SAFE_CONFIG_SOURCE> / platform_toolsets",
        observedAt: now.toISOString(),
        state: "ready",
        ...(truncated ? { truncated: true } : {}),
      },
      metadata: [
        { label: "Platform", value: "CLI" },
        { label: "Enabled", value: String(enabled), mono: true },
        { label: "Disabled", value: String(disabled), mono: true },
        { label: "Modified", value: modifiedAt, mono: true },
        { label: "Secrets", value: "Not read" },
      ],
      collection: { kind: "tools", items },
    };
  } catch (error) {
    const code = classifySourceError(error);
    return toolsFailure(sourceStateForCode(code), code, now);
  }
}

export async function readSkillPreview(
  context: HermesContext,
  requestedId: string,
  now: Date = new Date(),
): Promise<SystemSource> {
  if (!skillIdPattern.test(requestedId)) throw new SourceSecurityError("invalid_path");
  const discovered = await discoverSkills(context, new Set(), false);
  const skill = discovered.skills.find((candidate) => candidate.item.id === requestedId);
  if (!skill || skill.item.status === "error") throw new SourceSecurityError("missing_source");
  const source = await readNamedTextSource(context.home, `skills/${skill.manifestRelativePath}`);
  return {
    id: skill.item.id,
    title: skill.item.name,
    category: skill.item.category,
    summary: skill.item.description,
    content: redactBrowserText(source.text),
    stamp: {
      id: skill.item.id,
      label: "Hermes skill manifest",
      path: `<HERMES_HOME> / skills / ${skill.manifestRelativePath}`,
      observedAt: now.toISOString(),
      state: "ready",
      ...(source.truncated ? { truncated: true } : {}),
    },
    metadata: [
      { label: "Type", value: "SKILL.md" },
      { label: "Category", value: skill.item.category },
      { label: "Size", value: formatByteCount(source.originalBytes), mono: true },
      { label: "Modified", value: source.modifiedAt, mono: true },
      { label: "Preview", value: source.truncated ? "Bounded / truncated" : "Available" },
    ],
  };
}
