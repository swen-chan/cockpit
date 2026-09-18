import "server-only";

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import type { AgentSurface } from "@/contracts/agents";
import { LAST_PANEL_COOKIE, panelSurfaceHref, panelSurfaceLabel } from "@/lib/panel-navigation";
import {
  chooseInitialPanelId,
  requirePanelSurface,
  resolvePanel,
  resolvePanelRegistry,
  type AgentPanelDescriptor,
  type PanelRegistry,
} from "@/server/panels/registry";
import { SourceSecurityError } from "@/server/security/errors";

export interface ScopedPageContext {
  readonly panel: AgentPanelDescriptor;
  readonly registry: PanelRegistry;
  readonly supported: boolean;
}

export function resolveScopedPage(
  requestedPanelId: string,
  surface: AgentSurface,
): ScopedPageContext {
  const registry = resolvePanelRegistry();
  const panel = resolvePanel(registry, requestedPanelId);
  let supported = true;
  try {
    requirePanelSurface(panel, surface);
  } catch (error) {
    if (error instanceof SourceSecurityError && error.code === "unsupported_capability") {
      supported = false;
    } else {
      throw error;
    }
  }
  return Object.freeze({ panel, registry, supported });
}

export function requireScopedPage(
  requestedPanelId: string,
  surface: AgentSurface,
): ScopedPageContext {
  try {
    return resolveScopedPage(requestedPanelId, surface);
  } catch (error) {
    if (error instanceof SourceSecurityError && error.code === "invalid_panel") notFound();
    throw error;
  }
}

export async function requireLegacyPageOrRedirect(surface: AgentSurface): Promise<void> {
  const registry = resolvePanelRegistry();
  if (registry.mode === "legacySingleHermes") return;

  const remembered = (await cookies()).get(LAST_PANEL_COOKIE)?.value;
  const panelId = chooseInitialPanelId(registry, remembered);
  const panel = resolvePanel(registry, panelId);
  const targetSurface = panel.surfaces.includes(surface) ? surface : "overview";
  redirect(panelSurfaceHref(panel.id, targetSurface));
}

export function scopedPageMetadata(requestedPanelId: string, surface: AgentSurface): Metadata {
  try {
    const { panel, supported } = resolveScopedPage(requestedPanelId, surface);
    const label = panelSurfaceLabel(panel, surface);
    return {
      title: {
        absolute: supported
          ? `${label} / ${panel.name} / Cockpit`
          : `${label} unsupported / ${panel.name} / Cockpit`,
      },
      description: `A local, read-only ${panel.name} inspection surface.`,
    };
  } catch {
    return {
      title: { absolute: "Agent unavailable / Cockpit" },
      description: "A local, read-only Agent inspection surface.",
    };
  }
}
