import { codexTaskPageSchema } from "@/contracts/codex";
import { conversationPageSchema } from "@/contracts/source-result";
import { parseScopedConversationPageQuery } from "@/server/http/query";
import { scopedFailureResponse, scopedSuccessResponse } from "@/server/http/scoped-route";
import { requireScopedPanelSurface, resolveScopedPanel } from "@/server/panels/routing";
import type { AgentPanelDescriptor } from "@/server/panels/registry";
import { loadAgentConversationPage } from "@/server/services/agents";

export async function GET(
  request: Request,
  context: RouteContext<"/api/agents/[panelId]/conversations">,
) {
  let panel: AgentPanelDescriptor | undefined;
  try {
    const { panelId } = await context.params;
    panel = resolveScopedPanel(panelId);
    requireScopedPanelSurface(panel, "conversations");
    const { cursor } = parseScopedConversationPageQuery(request);
    const page = await loadAgentConversationPage(panel, { cursor, signal: request.signal });
    return scopedSuccessResponse(
      panel,
      page,
      panel.runtime === "codex" ? codexTaskPageSchema : conversationPageSchema,
    );
  } catch (error) {
    return scopedFailureResponse(error, {
      sourceId: "conversation-store",
      ...(panel ? { panel } : {}),
    });
  }
}
