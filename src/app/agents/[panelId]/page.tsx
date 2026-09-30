import type { Metadata } from "next";
import { ClaudeOverview } from "@/components/claude-overview";
import { claudePageQuery, type ClaudePageSearch } from "@/server/claude/page-query";

import { LastPanelCommit } from "@/components/last-panel-commit";
import { UnsupportedSurface } from "@/components/scoped-surface-state";
import { agentSurfaceSchema } from "@/contracts/agents";
import { CodexOverviewStatus } from "@/features/overview/codex-overview-status";
import { OverviewDashboard } from "@/features/overview/overview-dashboard";
import { requireScopedPage, scopedPageMetadata } from "@/server/panels/page-routing";
import { loadAgentOverview } from "@/server/services/agents";

type Props = {
  params: Promise<{ panelId: string }>;
  searchParams: Promise<ClaudePageSearch>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return scopedPageMetadata((await params).panelId, "overview");
}

export default async function AgentOverviewPage({ params, searchParams }: Props) {
  const { panelId } = await params;
  const context = requireScopedPage(panelId, "overview");
  if (context.state !== "ready") return null;
  const { panel, supported } = context;
  if (panel.runtime === "claude-code") {
    const { project } = claudePageQuery(panel, await searchParams);
    const snapshot = await loadAgentOverview(panel, { projectId: project.id });
    return (
      <>
        <LastPanelCommit panelId={panel.id} />
        <ClaudeOverview snapshot={snapshot} />
      </>
    );
  }
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
        <OverviewDashboard snapshot={snapshot} panelId={panel.id} />
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
