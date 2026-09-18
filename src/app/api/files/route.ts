import { workspaceDirectorySchema } from "@/contracts/source-result";
import { parseDirectoryQuery } from "@/server/http/query";
import { requireLegacyApiMode } from "@/server/panels/routing";
import { loadWorkspaceDirectory } from "@/server/services/files";
import { logSafeDiagnostic, toSafeDiagnostic } from "@/server/security/errors";

const responseHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    requireLegacyApiMode();
    const relativePath = parseDirectoryQuery(request);
    const directory = await loadWorkspaceDirectory(relativePath);
    const parsed = workspaceDirectorySchema.safeParse(directory);
    if (!parsed.success) throw new Error("invalid workspace directory");
    return Response.json(parsed.data, { headers: responseHeaders });
  } catch (error) {
    const diagnostic = toSafeDiagnostic(error, "workspace");
    const status =
      diagnostic.code === "invalid_path" ||
      diagnostic.code === "excluded_path" ||
      diagnostic.code === "path_outside_root" ||
      diagnostic.code === "panel_required"
        ? 400
        : 503;
    if (status >= 500) logSafeDiagnostic(diagnostic);
    return Response.json(diagnostic, { headers: responseHeaders, status });
  }
}
