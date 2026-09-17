import type { Metadata } from "next";

import { LastPanelCommit } from "@/components/last-panel-commit";
import { UnsupportedSurface } from "@/components/scoped-surface-state";
import { agentSurfaceSchema } from "@/contracts/agents";
import { CodexOverviewStatus } from "@/features/overview/codex-overview-status";
import { OverviewDashboard } from "@/features/overview/overview-dashboard";
import { panelSurfaceHref } from "@/lib/panel-navigation";
import { requireScopedPage, scopedPageMetadata } from "@/server/panels/page-routing";
import { loadAgentOverview } from "@/server/services/agents";

type Props = {
  params: Promise<{ panelId: string }>;
  searchParams: Promise<{ from?: string | string[] | undefined }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return scopedPageMetadata((await params).panelId, "overview");
}

export default async function AgentOverviewPage({ params, searchParams }: Props) {
  const { panelId } = await params;
  const { panel, supported } = requireScopedPage(panelId, "overview");
  if (!supported) return <UnsupportedSurface panel={panel} surface="overview" />;

  const fromValue = (await searchParams).from;
  const parsedFrom = agentSurfaceSchema.safeParse(Array.isArray(fromValue) ? undefined : fromValue);
  const fallbackFrom =
    parsedFrom.success && !panel.surfaces.includes(parsedFrom.data)
      ? parsedFrom.data[0]!.toUpperCase() + parsedFrom.data.slice(1)
      : undefined;
  if (panel.runtime === "hermes") {
    const snapshot = await loadAgentOverview(panel);
    return (
      <>
        <LastPanelCommit panelId={panel.id} />
        <OverviewDashboard snapshot={snapshot} basePath={panelSurfaceHref(panel.id, "overview")} />
      </>
    );
  }

  const snapshot = await loadAgentOverview(panel);
  return (
    <>
      <LastPanelCommit panelId={panel.id} />
      <CodexOverviewStatus snapshot={snapshot} fallbackFrom={fallbackFrom} />
    </>
  );
}
