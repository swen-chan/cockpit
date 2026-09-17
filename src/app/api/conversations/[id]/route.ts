import { conversationSchema } from "@/contracts/source-result";
import { parseConversationRequest } from "@/server/http/query";
import { requireLegacyApiMode } from "@/server/panels/routing";
import { logSafeDiagnostic, toSafeDiagnostic } from "@/server/security/errors";
import { loadConversationTranscript } from "@/server/services/conversations";

const responseHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request, context: RouteContext<"/api/conversations/[id]">) {
  try {
    requireLegacyApiMode();
    const { id } = await context.params;
    const requestedId = parseConversationRequest(request, id);
    const conversation = await loadConversationTranscript(requestedId);
    const parsed = conversationSchema.safeParse(conversation);
    if (!parsed.success) throw new Error("invalid conversation transcript");
    return Response.json(parsed.data, { headers: responseHeaders });
  } catch (error) {
    const diagnostic = toSafeDiagnostic(error, "conversation-store");
    const status =
      diagnostic.code === "invalid_path" || diagnostic.code === "panel_required"
        ? 400
        : diagnostic.code === "missing_source"
          ? 404
          : 503;
    if (status >= 500) logSafeDiagnostic(diagnostic);
    return Response.json(diagnostic, { headers: responseHeaders, status });
  }
}
