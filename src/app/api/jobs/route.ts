import { jobsSnapshotSchema } from "@/contracts/source-result";
import { assertNoQuery } from "@/server/http/query";
import { loadJobsSnapshot } from "@/server/services/jobs";
import { logSafeDiagnostic, toSafeDiagnostic } from "@/server/security/errors";

const responseHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    assertNoQuery(request);
    const snapshot = await loadJobsSnapshot();
    const parsed = jobsSnapshotSchema.safeParse(snapshot);
    if (!parsed.success) throw new Error("invalid jobs snapshot");
    return Response.json(parsed.data, { headers: responseHeaders });
  } catch (error) {
    const diagnostic = toSafeDiagnostic(error, "jobs");
    const status = diagnostic.code === "invalid_path" ? 400 : 503;
    if (status >= 500) logSafeDiagnostic(diagnostic);
    return Response.json(diagnostic, {
      headers: responseHeaders,
      status,
    });
  }
}
