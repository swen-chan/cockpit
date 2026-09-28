import "server-only";

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import type { AgentSurface } from "@/contracts/agents";
import { panelSurfaceLabel } from "@/lib/panel-navigation";
import {
  resolvePanel,
  resolvePanelRegistry,
  type AgentPanelDescriptor,
  type PanelConfigurationState,
  type PanelRegistry,
} from "@/server/panels/registry";
import { SourceSecurityError } from "@/server/security/errors";

export interface ScopedPageContext {
  readonly state: "ready";
  readonly panel: AgentPanelDescriptor;
  readonly registry: PanelRegistry;
  readonly supported: boolean;
}

export function resolveScopedPage(
  requestedPanelId: string,
  surface: AgentSurface,
): ScopedPageContext | PanelConfigurationState {
  const registry = resolvePanelRegistry();
  if (registry.state !== "ready") return registry;
  const panel = resolvePanel(registry, requestedPanelId);
  return { state: "ready", panel, registry, supported: panel.surfaces.includes(surface) };
}

export function requireScopedPage(
  requestedPanelId: string,
  surface: AgentSurface,
): ScopedPageContext | PanelConfigurationState {
  try {
    return resolveScopedPage(requestedPanelId, surface);
  } catch (error) {
    if (error instanceof SourceSecurityError && error.code === "invalid_panel") notFound();
    throw error;
  }
}

export function scopedPageMetadata(requestedPanelId: string, surface: AgentSurface): Metadata {
  let context;
  try {
    context = resolveScopedPage(requestedPanelId, surface);
  } catch (error) {
    if (!(error instanceof SourceSecurityError) || error.code !== "invalid_panel") throw error;
    return { title: { absolute: "Agent unavailable / Cockpit" } };
  }
  if (context.state !== "ready") {
    return { title: { absolute: "Configure Agents / Cockpit" } };
  }
  const { panel, supported } = context;
  const label = panelSurfaceLabel(panel, surface);
  return {
    title: {
      absolute: supported
        ? `${label} / ${panel.name} / Cockpit`
        : `${label} unsupported / ${panel.name} / Cockpit`,
    },
    description: `A local, read-only ${panel.name} inspection surface.`,
  };
}
