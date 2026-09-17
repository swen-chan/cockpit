import { codexSystemSnapshotSchema } from "@/contracts/codex";
import { systemSnapshotSchema } from "@/contracts/source-result";
import { assertNoQuery } from "@/server/http/query";
import { scopedFailureResponse, scopedSuccessResponse } from "@/server/http/scoped-route";
import { requireScopedPanelSurface, resolveScopedPanel } from "@/server/panels/routing";
import type { AgentPanelDescriptor } from "@/server/panels/registry";
import { loadAgentSystem } from "@/server/services/agents";

export async function GET(request: Request, context: RouteContext<"/api/agents/[panelId]/system">) {
  let panel: AgentPanelDescriptor | undefined;
  try {
    const { panelId } = await context.params;
    panel = resolveScopedPanel(panelId);
    requireScopedPanelSurface(panel, "system");
    assertNoQuery(request);
    const snapshot = await loadAgentSystem(panel, { signal: request.signal });
    return scopedSuccessResponse(
      panel,
      snapshot,
      panel.runtime === "codex" ? codexSystemSnapshotSchema : systemSnapshotSchema,
    );
  } catch (error) {
    return scopedFailureResponse(error, { sourceId: "system", ...(panel ? { panel } : {}) });
  }
}
