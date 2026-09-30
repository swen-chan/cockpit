import { parseClaudeQuery } from "@/server/http/query";
import { claudeSessionDetailSchema } from "@/contracts/claude";
import { codexTaskDetailSchema } from "@/contracts/codex";
import { conversationSchema } from "@/contracts/source-result";
import { parseScopedConversationRequest } from "@/server/http/query";
import { scopedFailureResponse, scopedSuccessResponse } from "@/server/http/scoped-route";
import { requireScopedPanelSurface, resolveScopedPanel } from "@/server/panels/routing";
import type { AgentPanelDescriptor } from "@/server/panels/registry";
import { loadAgentConversationDetail } from "@/server/services/agents";

export async function GET(
  request: Request,
  context: RouteContext<"/api/agents/[panelId]/conversations/[id]">,
) {
  let panel: AgentPanelDescriptor | undefined;
  try {
    const { panelId, id } = await context.params;
    panel = resolveScopedPanel(panelId);
    requireScopedPanelSurface(panel, "conversations");
    const requestedId = parseScopedConversationRequest(
      request,
      id,
      panel.runtime === "claude-code",
    );
    const detail = await loadAgentConversationDetail(panel, requestedId, {
      signal: request.signal,
      ...(panel.runtime === "claude-code"
        ? { projectId: parseClaudeQuery(request).projectId }
        : {}),
    });
    return scopedSuccessResponse(
      panel,
      detail,
      panel.runtime === "codex"
        ? codexTaskDetailSchema
        : panel.runtime === "claude-code"
          ? claudeSessionDetailSchema
          : conversationSchema,
    );
  } catch (error) {
    return scopedFailureResponse(error, {
      sourceId: "conversation-store",
      missingSourceStatus: 404,
      ...(panel ? { panel } : {}),
    });
  }
}
