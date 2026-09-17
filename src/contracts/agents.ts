import { z } from "zod";

export const agentPanelIdSchema = z.enum(["hermes", "codex"]);
export const agentRuntimeSchema = z.enum(["hermes", "codex"]);
export const agentSurfaceSchema = z.enum(["overview", "system", "conversations", "files", "jobs"]);
export const isoTimestampSchema = z.iso.datetime({ offset: true });

const hermesSurfaceTuple = z.tuple([
  z.literal("overview"),
  z.literal("system"),
  z.literal("conversations"),
  z.literal("files"),
  z.literal("jobs"),
]);
const codexSurfaceTuple = z.tuple([
  z.literal("overview"),
  z.literal("system"),
  z.literal("conversations"),
]);
const codexFilesSurfaceTuple = z.tuple([
  z.literal("overview"),
  z.literal("system"),
  z.literal("conversations"),
  z.literal("files"),
]);

export const publicAgentPanelSchema = z.union([
  z
    .object({
      id: z.literal("hermes"),
      name: z.literal("Hermes"),
      runtime: z.literal("hermes"),
      surfaces: hermesSurfaceTuple,
    })
    .strict(),
  z
    .object({
      id: z.literal("codex"),
      name: z.literal("Codex"),
      runtime: z.literal("codex"),
      surfaces: z.union([codexSurfaceTuple, codexFilesSurfaceTuple]),
    })
    .strict(),
]);

export const scopedSafeErrorCodeSchema = z.enum([
  "invalid_path",
  "path_outside_root",
  "excluded_path",
  "missing_source",
  "invalid_profile",
  "source_busy",
  "source_too_large",
  "source_malformed",
  "unsupported_source_version",
  "source_unavailable",
  "panel_required",
  "invalid_panel",
  "unsupported_capability",
  "unsupported_runtime_version",
  "protocol_violation",
]);

export type ScopedSafeErrorCode = z.infer<typeof scopedSafeErrorCodeSchema>;

export const SAFE_ERROR_MESSAGES = Object.freeze({
  invalid_path: "The requested relative path is invalid.",
  path_outside_root: "The requested path is outside the approved root.",
  excluded_path: "The requested path is excluded by Cockpit policy.",
  missing_source: "The requested local source is unavailable.",
  invalid_profile: "The selected Hermes profile is invalid or unavailable.",
  source_busy: "The local source is temporarily busy.",
  source_too_large: "The local source is too large to inspect safely.",
  source_malformed: "The local source could not be safely interpreted.",
  unsupported_source_version: "The selected source preset is not supported.",
  source_unavailable: "The local source could not be read.",
  panel_required: "An Agent panel is required for this request.",
  invalid_panel: "The requested Agent panel is unavailable.",
  unsupported_capability: "The selected Agent does not support this surface.",
  unsupported_runtime_version: "The selected Agent runtime version is not supported.",
  protocol_violation: "The local Agent reader returned an invalid response.",
} satisfies Readonly<Record<ScopedSafeErrorCode, string>>);

export const safePublicMessageSchema = z.enum([
  "The requested relative path is invalid.",
  "The requested path is outside the approved root.",
  "The requested path is excluded by Cockpit policy.",
  "The requested local source is unavailable.",
  "The selected Hermes profile is invalid or unavailable.",
  "The local source is temporarily busy.",
  "The local source is too large to inspect safely.",
  "The local source could not be safely interpreted.",
  "The selected source preset is not supported.",
  "The local source could not be read.",
  "An Agent panel is required for this request.",
  "The requested Agent panel is unavailable.",
  "The selected Agent does not support this surface.",
  "The selected Agent runtime version is not supported.",
  "The local Agent reader returned an invalid response.",
]);

const safeSourceIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u);

export const scopedFailureSchema = z
  .object({
    panelId: agentPanelIdSchema.optional(),
    sourceId: safeSourceIdSchema,
    code: scopedSafeErrorCodeSchema,
    message: safePublicMessageSchema,
    observedAt: isoTimestampSchema,
  })
  .strict()
  .superRefine((failure, context) => {
    if (failure.message !== SAFE_ERROR_MESSAGES[failure.code]) {
      context.addIssue({
        code: "custom",
        message: "Failure message does not match its safe code.",
      });
    }
  });

export function scopedSuccessSchema<T extends z.ZodType>(data: T) {
  return z.union([
    z.object({ panelId: z.literal("hermes"), runtime: z.literal("hermes"), data }).strict(),
    z.object({ panelId: z.literal("codex"), runtime: z.literal("codex"), data }).strict(),
  ]);
}

export type AgentPanelId = z.infer<typeof agentPanelIdSchema>;
export type AgentRuntime = z.infer<typeof agentRuntimeSchema>;
export type AgentSurface = z.infer<typeof agentSurfaceSchema>;
type ParsedPublicAgentPanel = z.infer<typeof publicAgentPanelSchema>;
export type PublicAgentPanel = Readonly<
  Omit<ParsedPublicAgentPanel, "surfaces"> & {
    surfaces: readonly AgentSurface[];
  }
>;
export type ScopedFailure = z.infer<typeof scopedFailureSchema>;
