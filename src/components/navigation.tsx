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

import { cn } from "@/lib/cn";

const items: Array<{ href: Route; label: string; icon: LucideIcon }> = [
  { href: "/", label: "Overview", icon: Gauge },
  { href: "/system", label: "System", icon: Settings2 },
  { href: "/conversations", label: "Conversations", icon: MessagesSquare },
  { href: "/files", label: "Files", icon: FileText },
  { href: "/jobs", label: "Jobs", icon: CalendarClock },
];

export function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="primary-nav" aria-label="Primary navigation">
      {items.map(({ href, icon: Icon, label }) => {
        const active = href === "/" ? pathname === href : pathname.startsWith(href);

        return (
          <Link
            href={href}
            key={href}
            className={cn("nav-link", active && "nav-link-active")}
            aria-current={active ? "page" : undefined}
          >
            <Icon aria-hidden="true" size={18} strokeWidth={1.7} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
