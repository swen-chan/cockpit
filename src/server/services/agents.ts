import "server-only";

import type { OverviewSnapshot } from "@/contracts/cockpit";
import type { CodexOverviewSnapshot } from "@/contracts/codex";
import type {
  AgentPanelDescriptor,
  CodexPanelDescriptor,
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
  panel: AgentPanelDescriptor,
  options?: AgentReadOptions,
): Promise<OverviewSnapshot | CodexOverviewSnapshot>;
export function loadAgentOverview(
  panel: AgentPanelDescriptor,
  options: AgentReadOptions = {},
): Promise<OverviewSnapshot | CodexOverviewSnapshot> {
  assertSourceReadAllowed();
  if (panel.runtime === "codex") return loadCodexOverviewSnapshot(panel, options);

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
  return loadConversationPage(options.cursor ?? null, 5, scopedHermesConversationOptions(panel));
}

export function loadAgentConversationDetail(
  panel: AgentPanelDescriptor,
  requestedId: string,
  options: AgentReadOptions = {},
) {
  if (panel.runtime === "codex") return loadCodexTaskDetail(panel, requestedId, options);
  return loadConversationTranscript(requestedId, scopedHermesConversationOptions(panel));
}

export function loadAgentWorkspaceDirectory(panel: AgentPanelDescriptor, relativePath: string) {
  if (panel.runtime === "codex") {
    return loadWorkspaceDirectory(relativePath, { workspaceRoot: codexWorkspaceRoot(panel) });
  }
  return loadWorkspaceDirectory(relativePath, scopedHermesFilesOptions(panel));
}

export function loadAgentWorkspacePreview(panel: AgentPanelDescriptor, relativePath: string) {
  if (panel.runtime === "codex") {
    return loadWorkspacePreview(relativePath, { workspaceRoot: codexWorkspaceRoot(panel) });
  }
  return loadWorkspacePreview(relativePath, scopedHermesFilesOptions(panel));
}

export function loadAgentJobs(panel: AgentPanelDescriptor) {
  if (panel.runtime !== "hermes") throw new SourceSecurityError("unsupported_capability");
  return loadJobsSnapshot(scopedHermesJobsOptions(panel));
}
