import { workspaceDirectorySchema } from "@/contracts/source-result";
import { parseDirectoryQuery } from "@/server/http/query";
import { scopedFailureResponse, scopedSuccessResponse } from "@/server/http/scoped-route";
import { requireScopedPanelSurface, resolveScopedPanel } from "@/server/panels/routing";
import type { AgentPanelDescriptor } from "@/server/panels/registry";
import { loadAgentWorkspaceDirectory } from "@/server/services/agents";

export async function GET(request: Request, context: RouteContext<"/api/agents/[panelId]/files">) {
  let panel: AgentPanelDescriptor | undefined;
  try {
    const { panelId } = await context.params;
    panel = resolveScopedPanel(panelId);
    requireScopedPanelSurface(panel, "files");
    const relativePath = parseDirectoryQuery(request);
    const directory = await loadAgentWorkspaceDirectory(panel, relativePath);
    return scopedSuccessResponse(panel, directory, workspaceDirectorySchema);
  } catch (error) {
    return scopedFailureResponse(error, { sourceId: "workspace", ...(panel ? { panel } : {}) });
  }
}
