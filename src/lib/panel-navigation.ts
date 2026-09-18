import type { AgentPanelId, AgentSurface, PublicAgentPanel } from "@/contracts/agents";

const SURFACE_SEGMENTS: Readonly<Record<AgentSurface, string>> = Object.freeze({
  overview: "",
  system: "/system",
  conversations: "/conversations",
  files: "/files",
  jobs: "/jobs",
});

export const LAST_PANEL_COOKIE = "cockpit_last_panel";

export function panelSurfaceHref(
  panelId: AgentPanelId,
  surface: AgentSurface,
): `/agents/${AgentPanelId}${string}` {
  return `/agents/${panelId}${SURFACE_SEGMENTS[surface]}`;
}

export function panelSurfaceLabel(
  panel: Pick<PublicAgentPanel, "runtime">,
  surface: AgentSurface,
): string {
  if (surface === "conversations") {
    return panel.runtime === "codex" ? "Tasks" : "Conversations";
  }
  return surface[0]!.toUpperCase() + surface.slice(1);
}

export function surfaceFromPathname(pathname: string): AgentSurface {
  const segments = pathname.split("/").filter(Boolean);
  const surface = segments[2];
  if (
    surface === "system" ||
    surface === "conversations" ||
    surface === "files" ||
    surface === "jobs"
  ) {
    return surface;
  }
  return "overview";
}

export function switchTarget(
  target: PublicAgentPanel,
  currentSurface: AgentSurface,
): { href: string; fallback: boolean } {
  const fallback = !target.surfaces.includes(currentSurface);
  const targetSurface = fallback ? "overview" : currentSurface;
  return {
    href: `${panelSurfaceHref(target.id, targetSurface)}?from=${currentSurface}`,
    fallback,
  };
}
