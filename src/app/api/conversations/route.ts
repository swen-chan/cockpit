import { conversationPageSchema } from "@/contracts/source-result";
import { parseConversationPageQuery } from "@/server/http/query";
import { requireLegacyApiMode } from "@/server/panels/routing";
import { loadConversationPage } from "@/server/services/conversations";
import { logSafeDiagnostic, toSafeDiagnostic } from "@/server/security/errors";

const responseHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    requireLegacyApiMode();
    const { cursor, limit } = parseConversationPageQuery(request);
    const page = await loadConversationPage(cursor, limit);
    const parsed = conversationPageSchema.safeParse(page);
    if (!parsed.success) throw new Error("invalid conversation page");
    return Response.json(parsed.data, { headers: responseHeaders });
  } catch (error) {
    const diagnostic = toSafeDiagnostic(error, "conversation-store");
    const status =
      diagnostic.code === "invalid_path" || diagnostic.code === "panel_required" ? 400 : 503;
    if (status >= 500) logSafeDiagnostic(diagnostic);
    return Response.json(diagnostic, { headers: responseHeaders, status });
  }
}
