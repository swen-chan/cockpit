import "server-only";

import { z } from "zod";

import {
  scopedFailureSchema,
  scopedSuccessSchema,
  type ScopedSafeErrorCode,
} from "@/contracts/agents";
import type { AgentPanelDescriptor } from "@/server/panels/registry";
import { logSafeDiagnostic, SourceSecurityError, toSafeDiagnostic } from "@/server/security/errors";

const responseHeaders = Object.freeze({ "Cache-Control": "private, no-store" });

export interface ScopedFailureResponseOptions {
  readonly sourceId: string;
  readonly panel?: AgentPanelDescriptor;
  readonly missingSourceStatus?: 404 | 503;
  readonly now?: Date;
}

export function statusForScopedFailure(
  code: ScopedSafeErrorCode,
  missingSourceStatus: 404 | 503 = 503,
): number {
  if (
    code === "invalid_path" ||
    code === "path_outside_root" ||
    code === "excluded_path" ||
    code === "panel_required"
  )
    return 400;
  if (code === "invalid_panel" || code === "unsupported_capability") return 404;
  if (code === "missing_source") return missingSourceStatus;
  return 503;
}

export function scopedSuccessResponse(
  panel: AgentPanelDescriptor,
  data: unknown,
  dataSchema: z.ZodType,
): Response {
  const parsed = scopedSuccessSchema(dataSchema).safeParse({
    panelId: panel.id,
    runtime: panel.runtime,
    data,
  });
  if (!parsed.success) throw new SourceSecurityError("protocol_violation");
  return Response.json(parsed.data, { headers: responseHeaders });
}

export function scopedFailureResponse(
  error: unknown,
  options: ScopedFailureResponseOptions,
): Response {
  const diagnostic = toSafeDiagnostic(error, options.sourceId, options.now);
  const parsed = scopedFailureSchema.safeParse({
    ...(options.panel ? { panelId: options.panel.id } : {}),
    ...diagnostic,
  });
  const failure = parsed.success
    ? parsed.data
    : scopedFailureSchema.parse({
        sourceId: "request",
        code: "source_unavailable",
        message: "The local source could not be read.",
        observedAt: (options.now ?? new Date()).toISOString(),
      });
  const status = statusForScopedFailure(failure.code, options.missingSourceStatus);
  if (status >= 500) logSafeDiagnostic(failure);
  return Response.json(failure, { headers: responseHeaders, status });
}
