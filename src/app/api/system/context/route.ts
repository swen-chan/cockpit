import { systemSourceSchema } from "@/contracts/source-result";
import { parseSkillQuery } from "@/server/http/query";
import { loadSkillPreview } from "@/server/services/system";
import { logSafeDiagnostic, toSafeDiagnostic } from "@/server/security/errors";

const responseHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const requestedId = parseSkillQuery(request);
    const source = await loadSkillPreview(requestedId);
    const parsed = systemSourceSchema.safeParse(source);
    if (!parsed.success) throw new Error("invalid system context");
    return Response.json(parsed.data, { headers: responseHeaders });
  } catch (error) {
    const diagnostic = toSafeDiagnostic(error, "skill-manifest");
    const status = diagnostic.code === "invalid_path" ? 400
      : diagnostic.code === "missing_source" ? 404 : 503;
    if (status >= 500) logSafeDiagnostic(diagnostic);
    return Response.json(diagnostic, { headers: responseHeaders, status });
  }
}
