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

const legacyItems: ReadonlyArray<{ href: Route; label: string; surface: AgentSurface }> = [
  { href: "/", label: "Overview", surface: "overview" },
  { href: "/system", label: "System", surface: "system" },
  { href: "/conversations", label: "Conversations", surface: "conversations" },
  { href: "/files", label: "Files", surface: "files" },
  { href: "/jobs", label: "Jobs", surface: "jobs" },
];

export function Navigation({ panel }: { panel?: PublicAgentPanel | undefined }) {
  const pathname = usePathname();
  const items = panel
    ? panel.surfaces.map((surface) => ({
        href: panelSurfaceHref(panel.id, surface) as Route,
        label: panelSurfaceLabel(panel, surface),
        surface,
      }))
    : legacyItems;

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
            {...(panel ? { prefetch: false } : {})}
          >
            <Icon aria-hidden="true" size={18} strokeWidth={1.7} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
