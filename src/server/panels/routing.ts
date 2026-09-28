import "server-only";

import type { AgentSurface } from "@/contracts/agents";
import {
  requirePanelSurface,
  resolvePanel,
  resolvePanelRegistry,
  type AgentPanelDescriptor,
} from "@/server/panels/registry";

export function resolveScopedPanel(
  requestedPanelId: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AgentPanelDescriptor {
  return resolvePanel(resolvePanelRegistry(environment), requestedPanelId);
}

export function requireScopedPanelSurface(
  panel: AgentPanelDescriptor,
  surface: AgentSurface,
): AgentPanelDescriptor {
  requirePanelSurface(panel, surface);
  return panel;
}
