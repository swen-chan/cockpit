import { overviewSnapshotSchema } from "@/contracts/source-result";
import { assertNoQuery } from "@/server/http/query";
import { logSafeDiagnostic, toSafeDiagnostic } from "@/server/security/errors";
import { loadOverviewSnapshot } from "@/server/services/overview";

const responseHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    assertNoQuery(request);
    const snapshot = await loadOverviewSnapshot();
    const parsed = overviewSnapshotSchema.safeParse(snapshot);
    if (!parsed.success) throw new Error("invalid overview snapshot");
    return Response.json(parsed.data, { headers: responseHeaders });
  } catch (error) {
    const diagnostic = toSafeDiagnostic(error, "overview");
    const status = diagnostic.code === "invalid_path" ? 400 : 503;
    if (status >= 500) logSafeDiagnostic(diagnostic);
    return Response.json(diagnostic, {
      headers: responseHeaders,
      status,
    });
  }
}
