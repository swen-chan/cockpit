import { codexOverviewSnapshotSchema } from "@/contracts/codex";
import { overviewSnapshotSchema } from "@/contracts/source-result";
import { claudeOverviewSnapshotSchema } from "@/contracts/claude-overview";
import { assertNoQuery, parseClaudeQuery } from "@/server/http/query";
import { scopedFailureResponse, scopedSuccessResponse } from "@/server/http/scoped-route";
import { requireScopedPanelSurface, resolveScopedPanel } from "@/server/panels/routing";
import type { AgentPanelDescriptor } from "@/server/panels/registry";
import { loadAgentOverview } from "@/server/services/agents";

export async function GET(
  request: Request,
  context: RouteContext<"/api/agents/[panelId]/overview">,
) {
  let panel: AgentPanelDescriptor | undefined;
  try {
    const { panelId } = await context.params;
    panel = resolveScopedPanel(panelId);
    requireScopedPanelSurface(panel, "overview");
    if (panel.runtime !== "claude-code") assertNoQuery(request);
    const snapshot = await loadAgentOverview(panel, {
      signal: request.signal,
      ...(panel.runtime === "claude-code"
        ? { projectId: parseClaudeQuery(request).projectId }
        : {}),
    });
    return scopedSuccessResponse(
      panel,
      snapshot,
      panel.runtime === "claude-code"
        ? claudeOverviewSnapshotSchema
        : panel.runtime === "codex"
          ? codexOverviewSnapshotSchema
          : overviewSnapshotSchema,
    );
  } catch (error) {
    return scopedFailureResponse(error, { sourceId: "overview", ...(panel ? { panel } : {}) });
  }
}
