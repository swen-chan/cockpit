import { workspaceFileSchema } from "@/contracts/source-result";
import { parsePreviewQuery } from "@/server/http/query";
import { scopedFailureResponse, scopedSuccessResponse } from "@/server/http/scoped-route";
import { requireScopedPanelSurface, resolveScopedPanel } from "@/server/panels/routing";
import type { AgentPanelDescriptor } from "@/server/panels/registry";
import { loadAgentWorkspacePreview } from "@/server/services/agents";

export async function GET(
  request: Request,
  context: RouteContext<"/api/agents/[panelId]/files/preview">,
) {
  let panel: AgentPanelDescriptor | undefined;
  try {
    const { panelId } = await context.params;
    panel = resolveScopedPanel(panelId);
    requireScopedPanelSurface(panel, "files");
    const relativePath = parsePreviewQuery(request);
    const file = await loadAgentWorkspacePreview(panel, relativePath);
    return scopedSuccessResponse(panel, file, workspaceFileSchema);
  } catch (error) {
    return scopedFailureResponse(error, {
      sourceId: "workspace",
      missingSourceStatus: 404,
      ...(panel ? { panel } : {}),
    });
  }
}
