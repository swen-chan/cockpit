"use client";

import {
  CalendarClock,
  FileText,
  Gauge,
  MessagesSquare,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

import type { AgentSurface, PublicAgentPanel } from "@/contracts/agents";
import { panelSurfaceHref, panelSurfaceLabel } from "@/lib/panel-navigation";
import { cn } from "@/lib/cn";

const icons: Readonly<Record<AgentSurface, LucideIcon>> = Object.freeze({
  overview: Gauge,
  system: Settings2,
  conversations: MessagesSquare,
  files: FileText,
  jobs: CalendarClock,
});

export function Navigation({ panel }: { panel: PublicAgentPanel }) {
  const pathname = usePathname();
  const items = panel.surfaces.map((surface) => ({
    href: panelSurfaceHref(panel.id, surface) as Route,
    label: panelSurfaceLabel(panel, surface),
    surface,
  }));

  return (
    <nav className="primary-nav" aria-label="Primary navigation">
      {items.map(({ href, label, surface }) => {
        const active = surface === "overview" ? pathname === href : pathname.startsWith(href);
        const Icon = icons[surface];

        return (
          <Link
            href={href}
            key={surface}
            className={cn("nav-link", active && "nav-link-active")}
            aria-current={active ? "page" : undefined}
            prefetch={false}
          >
            <Icon aria-hidden="true" size={18} strokeWidth={1.7} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
