import { parseClaudeQuery } from "@/server/http/query";
import { claudeSessionPageSchema } from "@/contracts/claude";
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
    const { cursor, projectId, sessionId } =
      panel.runtime === "claude-code"
        ? parseClaudeQuery(request, "page")
        : { ...parseScopedConversationPageQuery(request), projectId: null, sessionId: null };
    const page = await loadAgentConversationPage(panel, {
      cursor,
      signal: request.signal,
      ...(panel.runtime === "claude-code" ? { projectId, sessionId } : {}),
    });
    return scopedSuccessResponse(
      panel,
      page,
      panel.runtime === "codex"
        ? codexTaskPageSchema
        : panel.runtime === "claude-code"
          ? claudeSessionPageSchema
          : conversationPageSchema,
    );
  } catch (error) {
    return scopedFailureResponse(error, {
      sourceId: "conversation-store",
      ...(panel ? { panel } : {}),
    });
  }
}
