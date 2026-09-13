import { systemSnapshotSchema } from "@/contracts/source-result";
import { assertNoQuery } from "@/server/http/query";
import { logSafeDiagnostic, toSafeDiagnostic } from "@/server/security/errors";
import { loadSystemPageData } from "@/server/services/system";

const responseHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    assertNoQuery(request);
    const snapshot = await loadSystemPageData();
    const parsed = systemSnapshotSchema.safeParse(snapshot);
    if (!parsed.success) throw new Error("invalid system snapshot");
    return Response.json(parsed.data, { headers: responseHeaders });
  } catch (error) {
    const diagnostic = toSafeDiagnostic(error, "system");
    const status = diagnostic.code === "invalid_path" ? 400 : 503;
    if (status >= 500) logSafeDiagnostic(diagnostic);
    return Response.json(diagnostic, { headers: responseHeaders, status });
  }
}
