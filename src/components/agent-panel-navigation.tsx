"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";

import {
  agentSurfaceSchema,
  type AgentPanelId,
  type AgentSurface,
  type PublicAgentPanel,
} from "@/contracts/agents";
import { panelSurfaceHref, surfaceFromPathname, switchTarget } from "@/lib/panel-navigation";
import { cn } from "@/lib/cn";

// Longer than the bounded Codex probe + snapshot + operation path, while still
// preventing a failed navigation from becoming a durable focus instruction.
const SWITCH_MARKER_MAX_AGE_MS = 30_000;
let pendingSwitch: {
  readonly from: AgentSurface;
  readonly panelId: AgentPanelId;
  readonly pathname: string;
  readonly startedAt: number;
} | null = null;

function rememberSameTabSwitch(
  event: ReactMouseEvent<HTMLAnchorElement>,
  href: string,
  panelId: AgentPanelId,
  from: AgentSurface,
): void {
  if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
    return;
  pendingSwitch = {
    from,
    panelId,
    pathname: new URL(href, window.location.origin).pathname,
    startedAt: Date.now(),
  };
}

export function AgentPanelNavigation({
  activePanel,
  panels,
}: {
  activePanel: PublicAgentPanel;
  panels: readonly PublicAgentPanel[];
}) {
  const pathname = usePathname();
  const activeLink = useRef<HTMLAnchorElement>(null);
  const announcement = useRef<HTMLParagraphElement>(null);
  const currentSurface = surfaceFromPathname(pathname);

  useEffect(() => {
    const url = new URL(window.location.href);
    const parsedFrom = agentSurfaceSchema.safeParse(url.searchParams.get("from"));
    if (!parsedFrom.success) return;

    const marker = pendingSwitch;
    pendingSwitch = null;
    const explicitSwitch =
      marker !== null &&
      Date.now() - marker.startedAt <= SWITCH_MARKER_MAX_AGE_MS &&
      marker.panelId === activePanel.id &&
      marker.pathname === url.pathname &&
      marker.from === parsedFrom.data;

    url.searchParams.delete("from");
    const search = url.searchParams.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${search ? `?${search}` : ""}${url.hash}`,
    );
    if (!explicitSwitch) return;

    const fellBack = !activePanel.surfaces.includes(parsedFrom.data);
    const sourceLabel = parsedFrom.data[0]!.toUpperCase() + parsedFrom.data.slice(1);
    if (announcement.current) {
      announcement.current.textContent = fellBack
        ? `Now viewing ${activePanel.name} Overview; ${sourceLabel} is not supported.`
        : `Now viewing ${activePanel.name}.`;
    }
    activeLink.current?.focus({ preventScroll: true });
  }, [activePanel.id, activePanel.name, activePanel.surfaces, pathname]);

  if (panels.length < 2) return null;

  return (
    <>
      <nav className="agent-panel-nav" aria-label="Agent panels">
        <span className="agent-panel-nav-label">AGENT PANELS</span>
        {panels.map((panel) => {
          const active = panel.id === activePanel.id;
          const target = active
            ? {
                href: panelSurfaceHref(
                  panel.id,
                  panel.surfaces.includes(currentSurface) ? currentSurface : "overview",
                ),
              }
            : switchTarget(panel, currentSurface);
          return (
            <Link
              ref={active ? activeLink : undefined}
              href={target.href as Route}
              prefetch={false}
              key={panel.id}
              className={cn("agent-panel-link", active && "agent-panel-link-active")}
              aria-current={active ? "location" : undefined}
              onClick={(event) => {
                if (!active) rememberSameTabSwitch(event, target.href, panel.id, currentSurface);
              }}
            >
              <span>{panel.name}</span>
              <small>{panel.runtime.toUpperCase()}</small>
            </Link>
          );
        })}
      </nav>
      <p
        ref={announcement}
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      />
    </>
  );
}
