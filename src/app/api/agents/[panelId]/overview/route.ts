import { codexOverviewSnapshotSchema } from "@/contracts/codex";
import { overviewSnapshotSchema } from "@/contracts/source-result";
import { assertNoQuery } from "@/server/http/query";
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
    assertNoQuery(request);
    const snapshot = await loadAgentOverview(panel, { signal: request.signal });
    return scopedSuccessResponse(
      panel,
      snapshot,
      panel.runtime === "codex" ? codexOverviewSnapshotSchema : overviewSnapshotSchema,
    );
  } catch (error) {
    return scopedFailureResponse(error, { sourceId: "overview", ...(panel ? { panel } : {}) });
  }
}
