import { notFound } from "next/navigation";

import { ScopedAppShell } from "@/components/app-shell";
import { resolvePanel, resolvePanelRegistry } from "@/server/panels/registry";
import { SourceSecurityError } from "@/server/security/errors";

export default async function AgentLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ panelId: string }>;
}) {
  const { panelId } = await params;
  const registry = resolvePanelRegistry();
  let panel;
  try {
    panel = resolvePanel(registry, panelId);
  } catch (error) {
    if (error instanceof SourceSecurityError && error.code === "invalid_panel") notFound();
    throw error;
  }
  const publicPanel = registry.publicPanels.find((candidate) => candidate.id === panel.id);
  if (!publicPanel) throw new SourceSecurityError("source_malformed");
  return (
    <ScopedAppShell activePanel={publicPanel} panels={registry.publicPanels}>
      {children}
    </ScopedAppShell>
  );
}
