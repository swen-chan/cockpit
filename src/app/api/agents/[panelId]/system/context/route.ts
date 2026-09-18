import { systemSourceSchema } from "@/contracts/source-result";
import { parseSkillQuery } from "@/server/http/query";
import { scopedFailureResponse, scopedSuccessResponse } from "@/server/http/scoped-route";
import { requireScopedPanelSurface, resolveScopedPanel } from "@/server/panels/routing";
import type { AgentPanelDescriptor } from "@/server/panels/registry";
import { SourceSecurityError } from "@/server/security/errors";
import { loadAgentSystemContext } from "@/server/services/agents";

export async function GET(
  request: Request,
  context: RouteContext<"/api/agents/[panelId]/system/context">,
) {
  let panel: AgentPanelDescriptor | undefined;
  try {
    const { panelId } = await context.params;
    panel = resolveScopedPanel(panelId);
    requireScopedPanelSurface(panel, "system");
    if (panel.runtime !== "hermes") throw new SourceSecurityError("unsupported_capability");
    const requestedId = parseSkillQuery(request);
    const source = await loadAgentSystemContext(panel, requestedId);
    return scopedSuccessResponse(panel, source, systemSourceSchema);
  } catch (error) {
    return scopedFailureResponse(error, {
      sourceId: "skill-manifest",
      missingSourceStatus: 404,
      ...(panel ? { panel } : {}),
    });
  }
}
