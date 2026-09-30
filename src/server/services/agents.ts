import "server-only";

import { readClaudeSessionPage, readClaudeSession } from "@/server/claude/reader";

import { resolveClaudeProject } from "@/server/claude/projects";
import { loadClaudeSystem } from "@/server/claude/system";
import { loadClaudeOverview } from "@/server/claude/overview";
import type { ClaudeOverviewSnapshot } from "@/contracts/claude-overview";
import type { OverviewSnapshot } from "@/contracts/cockpit";
import type { CodexOverviewSnapshot } from "@/contracts/codex";
import type {
  AgentPanelDescriptor,
  CodexPanelDescriptor,
  ClaudePanelDescriptor,
  HermesPanelDescriptor,
} from "@/server/panels/registry";
import { SourceSecurityError } from "@/server/security/errors";
import { assertSourceReadAllowed } from "@/server/security/prerender-guard";
import { loadCodexOverviewSnapshot } from "@/server/services/codex-overview";
import { loadCodexSystemSnapshot } from "@/server/services/codex-system";
import { loadCodexTaskDetail, loadCodexTaskPage } from "@/server/services/codex-tasks";
import { loadConversationPage, loadConversationTranscript } from "@/server/services/conversations";
import { loadWorkspaceDirectory, loadWorkspacePreview } from "@/server/services/files";
import {
  scopedHermesConversationOptions,
  scopedHermesFilesOptions,
  scopedHermesJobsOptions,
  scopedHermesSkillOptions,
  scopedHermesSystemOptions,
} from "@/server/services/hermes-scoped";
import { loadJobsSnapshot } from "@/server/services/jobs";
import { loadOverviewSnapshot } from "@/server/services/overview";
import {
  loadCoreSystemSources,
  loadProfileFromEnvironment,
  loadSkillPreview,
  loadSystemPageData,
} from "@/server/services/system";

export interface AgentReadOptions {
  readonly signal?: AbortSignal;
  readonly projectId?: string | null;
}

export interface AgentPageOptions extends AgentReadOptions {
  readonly cursor?: string | null;
}

function codexWorkspaceRoot(panel: CodexPanelDescriptor): string {
  const root = panel.configuration.workspaceRoot;
  if (root === undefined) throw new SourceSecurityError("unsupported_capability");
  return root;
}

export function loadAgentOverview(
  panel: HermesPanelDescriptor,
  options?: AgentReadOptions,
): Promise<OverviewSnapshot>;
export function loadAgentOverview(
  panel: CodexPanelDescriptor,
  options?: AgentReadOptions,
): Promise<CodexOverviewSnapshot>;
export function loadAgentOverview(
  panel: ClaudePanelDescriptor,
  options?: AgentReadOptions,
): Promise<ClaudeOverviewSnapshot>;
export function loadAgentOverview(
  panel: AgentPanelDescriptor,
  options?: AgentReadOptions,
): Promise<OverviewSnapshot | CodexOverviewSnapshot | ClaudeOverviewSnapshot>;
export function loadAgentOverview(
  panel: AgentPanelDescriptor,
  options: AgentReadOptions = {},
): Promise<OverviewSnapshot | CodexOverviewSnapshot | ClaudeOverviewSnapshot> {
  assertSourceReadAllowed();
  if (panel.runtime === "codex") return loadCodexOverviewSnapshot(panel, options);
  if (panel.runtime === "claude-code") return loadClaudeOverview(panel, options.projectId);

  if (panel.runtime !== "hermes") throw new SourceSecurityError("unsupported_capability");
  const systemOptions = scopedHermesSystemOptions(panel);
  return loadOverviewSnapshot({
    readers: {
      profile: () => loadProfileFromEnvironment(systemOptions),
      conversations: () => loadConversationPage(null, 5, scopedHermesConversationOptions(panel)),
      system: () => loadCoreSystemSources(systemOptions),
      jobs: () => loadJobsSnapshot(scopedHermesJobsOptions(panel)),
      workspace: () => loadWorkspaceDirectory("", scopedHermesFilesOptions(panel)),
    },
  });
}

export function loadAgentSystem(panel: AgentPanelDescriptor, options: AgentReadOptions = {}) {
  assertSourceReadAllowed();
  if (panel.runtime === "codex") return loadCodexSystemSnapshot(panel, options);
  if (panel.runtime === "claude-code") return loadClaudeSystem(panel, options.projectId);
  if (panel.runtime !== "hermes") throw new SourceSecurityError("unsupported_capability");
  return loadSystemPageData(scopedHermesSystemOptions(panel));
}

export function loadAgentSystemContext(panel: AgentPanelDescriptor, requestedId: string) {
  if (panel.runtime !== "hermes") throw new SourceSecurityError("unsupported_capability");
  return loadSkillPreview(requestedId, scopedHermesSkillOptions(panel));
}

export function loadAgentConversationPage(
  panel: AgentPanelDescriptor,
  options: AgentPageOptions = {},
) {
  if (panel.runtime === "codex") return loadCodexTaskPage(panel, options);
  if (panel.runtime === "claude-code")
    return readClaudeSessionPage(panel, options.cursor, options.projectId);
  return loadConversationPage(options.cursor ?? null, 5, scopedHermesConversationOptions(panel));
}

export function loadAgentConversationDetail(
  panel: AgentPanelDescriptor,
  requestedId: string,
  options: AgentReadOptions = {},
) {
  if (panel.runtime === "codex") return loadCodexTaskDetail(panel, requestedId, options);
  if (panel.runtime === "claude-code")
    return readClaudeSession(panel, requestedId, options.projectId);
  return loadConversationTranscript(requestedId, scopedHermesConversationOptions(panel));
}

export function loadAgentWorkspaceDirectory(
  panel: AgentPanelDescriptor,
  relativePath: string,
  projectId?: string | null,
) {
  if (panel.runtime === "codex") {
    return loadWorkspaceDirectory(relativePath, { workspaceRoot: codexWorkspaceRoot(panel) });
  }
  if (panel.runtime === "claude-code")
    return loadWorkspaceDirectory(relativePath, {
      workspaceRoot: resolveClaudeProject(panel, projectId).workspaceRoot,
    });
  if (panel.runtime !== "hermes") throw new SourceSecurityError("unsupported_capability");
  return loadWorkspaceDirectory(relativePath, scopedHermesFilesOptions(panel));
}

export function loadAgentWorkspacePreview(
  panel: AgentPanelDescriptor,
  relativePath: string,
  projectId?: string | null,
) {
  if (panel.runtime === "codex") {
    return loadWorkspacePreview(relativePath, { workspaceRoot: codexWorkspaceRoot(panel) });
  }
  if (panel.runtime === "claude-code")
    return loadWorkspacePreview(relativePath, {
      workspaceRoot: resolveClaudeProject(panel, projectId).workspaceRoot,
    });
  if (panel.runtime !== "hermes") throw new SourceSecurityError("unsupported_capability");
  return loadWorkspacePreview(relativePath, scopedHermesFilesOptions(panel));
}

export function loadAgentJobs(panel: AgentPanelDescriptor) {
  if (panel.runtime !== "hermes") throw new SourceSecurityError("unsupported_capability");
  return loadJobsSnapshot(scopedHermesJobsOptions(panel));
}
