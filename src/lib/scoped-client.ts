import { z } from "zod";

import {
  scopedFailureSchema,
  scopedSuccessSchema,
  type AgentPanelId,
  type ScopedFailure,
} from "@/contracts/agents";

export function scopedApiPath(panelId: AgentPanelId, suffix: string): string {
  const normalized = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `/api/agents/${panelId}${normalized}`;
}

export function parseScopedPayload<T>(
  payload: unknown,
  panelId: AgentPanelId,
  schema: z.ZodType<T>,
): T | null {
  const parsed = scopedSuccessSchema(schema).safeParse(payload);
  return parsed.success && parsed.data.panelId === panelId ? parsed.data.data : null;
}

export function parseScopedFailure(payload: unknown, panelId: AgentPanelId): ScopedFailure | null {
  const parsed = scopedFailureSchema.safeParse(payload);
  return parsed.success && parsed.data.panelId === panelId ? parsed.data : null;
}

export function isCurrentPanelLocation(panelId: AgentPanelId): boolean {
  if (typeof window === "undefined") return false;
  return window.location.pathname.split("/").filter(Boolean)[1] === panelId;
}
