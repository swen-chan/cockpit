import { workspaceFileSchema } from "@/contracts/source-result";
import { parsePreviewQuery } from "@/server/http/query";
import { loadWorkspacePreview } from "@/server/services/files";
import { logSafeDiagnostic, toSafeDiagnostic } from "@/server/security/errors";

const responseHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const relativePath = parsePreviewQuery(request);
    const file = await loadWorkspacePreview(relativePath);
    const parsed = workspaceFileSchema.safeParse(file);
    if (!parsed.success) throw new Error("invalid workspace preview");
    return Response.json(parsed.data, { headers: responseHeaders });
  } catch (error) {
    const diagnostic = toSafeDiagnostic(error, "workspace");
    const status = diagnostic.code === "invalid_path"
      || diagnostic.code === "excluded_path"
      || diagnostic.code === "path_outside_root" ? 400
      : diagnostic.code === "missing_source" ? 404 : 503;
    if (status >= 500) logSafeDiagnostic(diagnostic);
    return Response.json(diagnostic, { headers: responseHeaders, status });
  }
}
