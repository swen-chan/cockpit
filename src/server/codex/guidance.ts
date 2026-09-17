import "server-only";

import { homedir } from "node:os";

import { codexGuidanceSourceSchema, type CodexSystemSnapshot } from "@/contracts/codex";
import { cleanCodexText } from "@/server/codex/safe-text";
import { readNamedTextSource } from "@/server/files/bounded-text";
import type { CodexPanelDescriptor } from "@/server/panels/registry";
import { SourceSecurityError } from "@/server/security/errors";
import { boundUtf8Text, SOURCE_LIMITS } from "@/server/security/limits";
import {
  canonicalizeDirectory,
  parseRelativePath,
  resolveApprovedWorkspacePath,
  resolveApprovedWorkspacePathIdentity,
} from "@/server/security/path-policy";

export type CodexGuidanceSource = CodexSystemSnapshot["sources"][number];

type GuidanceKey = CodexGuidanceSource["key"];
type GuidanceFailureState = "missing" | "unavailable" | "error";

interface GuidanceSpec {
  readonly key: GuidanceKey;
  readonly label: CodexGuidanceSource["label"];
  readonly origin: "Codex home" | "Approved workspace" | "Configured workspace file";
  readonly root: string;
  readonly candidates: readonly string[];
}

const identities = Object.freeze({
  "global-guidance": Object.freeze({
    label: "Global guidance" as const,
    origin: "Codex home" as const,
  }),
  "workspace-guidance": Object.freeze({
    label: "Workspace guidance" as const,
    origin: "Approved workspace" as const,
  }),
  "custom-guidance": Object.freeze({
    label: "Custom guidance" as const,
    origin: "Configured workspace file" as const,
  }),
});

function failure(spec: GuidanceSpec, state: GuidanceFailureState): CodexGuidanceSource {
  const message =
    state === "missing"
      ? "No current guidance was observed."
      : state === "unavailable"
        ? "Current guidance is unavailable."
        : "Current guidance could not be read safely.";
  return codexGuidanceSourceSchema.parse({
    key: spec.key,
    label: spec.label,
    state,
    message,
  });
}

function sourceFailureState(error: unknown): "missing" | "error" {
  return error instanceof SourceSecurityError && error.code === "missing_source"
    ? "missing"
    : "error";
}

function specs(panel: CodexPanelDescriptor): GuidanceSpec[] {
  const guidance: GuidanceSpec[] = [
    {
      key: "global-guidance",
      ...identities["global-guidance"],
      root: panel.configuration.home,
      candidates: ["AGENTS.override.md", "AGENTS.md"],
    },
  ];
  if (panel.configuration.workspaceRoot) {
    guidance.push({
      key: "workspace-guidance",
      ...identities["workspace-guidance"],
      root: panel.configuration.workspaceRoot,
      candidates: ["AGENTS.override.md", "AGENTS.md"],
    });
    if (panel.configuration.customGuidance) {
      guidance.push({
        key: "custom-guidance",
        ...identities["custom-guidance"],
        root: panel.configuration.workspaceRoot,
        candidates: [panel.configuration.customGuidance],
      });
    }
  }
  return guidance;
}

async function readSpec(
  spec: GuidanceSpec,
  seenCanonicalFiles: Set<string>,
  panel: CodexPanelDescriptor,
): Promise<CodexGuidanceSource | null> {
  let canonicalRoot: string;
  try {
    canonicalRoot = canonicalizeDirectory(spec.root);
  } catch {
    return failure(spec, "unavailable");
  }

  for (const candidate of spec.candidates) {
    let resolved: ReturnType<typeof resolveApprovedWorkspacePath>;
    let reservedIdentity: string | undefined;
    try {
      const relativePath = parseRelativePath(candidate).join("/");
      const identity = resolveApprovedWorkspacePathIdentity(
        canonicalRoot,
        relativePath,
        canonicalRoot,
      );
      if (seenCanonicalFiles.has(identity)) return null;
      seenCanonicalFiles.add(identity);
      reservedIdentity = identity;
      resolved = resolveApprovedWorkspacePath(canonicalRoot, relativePath, {
        base: canonicalRoot,
        kind: "file",
      });
      if (resolved.absolutePath !== reservedIdentity) {
        seenCanonicalFiles.delete(reservedIdentity);
        if (seenCanonicalFiles.has(resolved.absolutePath)) return null;
        seenCanonicalFiles.add(resolved.absolutePath);
        reservedIdentity = resolved.absolutePath;
      }
    } catch (error) {
      if (reservedIdentity === undefined && sourceFailureState(error) === "missing") continue;
      return failure(spec, "error");
    }

    let source: Awaited<ReturnType<typeof readNamedTextSource>>;
    try {
      source = await readNamedTextSource(canonicalRoot, resolved.relativePath, {
        maxBytes: SOURCE_LIMITS.maxPreviewBytes,
        maxCharacters: SOURCE_LIMITS.maxPreviewCharacters,
        rejectOversized: true,
      });
    } catch {
      // The candidate existed when it was selected. A later disappearance or
      // read failure is a scoped error, not permission to fall back silently.
      return failure(spec, "error");
    }

    if (source.originalBytes === 0) {
      seenCanonicalFiles.delete(reservedIdentity);
      continue;
    }
    const cleaned = cleanCodexText(source.text, panel, homedir());
    if (cleaned.text === null) {
      if (cleaned.policyChanged) return failure(spec, "error");
      seenCanonicalFiles.delete(reservedIdentity);
      continue;
    }
    const content = boundUtf8Text(
      cleaned.text,
      SOURCE_LIMITS.maxPreviewBytes,
      SOURCE_LIMITS.maxPreviewCharacters,
    );
    if (content.text.length === 0) {
      seenCanonicalFiles.delete(reservedIdentity);
      continue;
    }
    return codexGuidanceSourceSchema.parse({
      key: spec.key,
      label: spec.label,
      origin: spec.origin,
      state: "ready",
      content: content.text,
      truncated: source.truncated || content.truncated,
    });
  }
  return failure(spec, "missing");
}

export async function loadCodexGuidanceSources(
  panel: CodexPanelDescriptor,
): Promise<CodexGuidanceSource[]> {
  const sources: CodexGuidanceSource[] = [];
  const seenCanonicalFiles = new Set<string>();
  for (const spec of specs(panel)) {
    const source = await readSpec(spec, seenCanonicalFiles, panel);
    if (source) sources.push(source);
  }
  return sources;
}

export function codexGuidanceFailureSources(
  panel: CodexPanelDescriptor,
  state: Exclude<GuidanceFailureState, "missing">,
): CodexGuidanceSource[] {
  return specs(panel).map((spec) => failure(spec, state));
}
