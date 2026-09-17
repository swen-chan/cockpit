import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell";
import { resolvePanelRegistry } from "@/server/panels/registry";
import { loadProfileForRequest } from "@/server/services/system";

export const metadata: Metadata = {
  title: "Cockpit / Hermes",
  description: "A local, read-only observability surface for Hermes.",
};

export default async function LegacyLayout({ children }: { children: React.ReactNode }) {
  const registry = resolvePanelRegistry();
  if (registry.mode !== "legacySingleHermes") return children;
  const profile = await loadProfileForRequest();
  return <AppShell profile={profile}>{children}</AppShell>;
}
