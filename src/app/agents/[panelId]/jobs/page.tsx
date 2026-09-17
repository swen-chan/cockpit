import type { Metadata } from "next";

import { LastPanelCommit } from "@/components/last-panel-commit";
import { PageHeader } from "@/components/page-header";
import { UnsupportedSurface } from "@/components/scoped-surface-state";
import { JobsBrowser } from "@/features/jobs/jobs-browser";
import { formatShanghaiTime } from "@/lib/time";
import { requireScopedPage, scopedPageMetadata } from "@/server/panels/page-routing";
import { scopedHermesJobsOptions } from "@/server/services/hermes-scoped";
import { loadJobsPageData } from "@/server/services/jobs";

type Props = { params: Promise<{ panelId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return scopedPageMetadata((await params).panelId, "jobs");
}

export default async function AgentJobsPage({ params }: Props) {
  const { panelId } = await params;
  const { panel, supported } = requireScopedPage(panelId, "jobs");
  if (!supported || panel.runtime !== "hermes") {
    return <UnsupportedSurface panel={panel} surface="jobs" />;
  }

  const data = await loadJobsPageData(scopedHermesJobsOptions(panel));
  return (
    <>
      <LastPanelCommit panelId={panel.id} />
      <div className="page-wrap">
        <PageHeader
          title="Jobs"
          description="Inspect schedules and recent execution metadata without exposing controls or job payloads."
          observedAt={formatShanghaiTime(data.observedAt)}
          mode="HERMES / READ ONLY"
        />
        <JobsBrowser
          jobs={data.jobs}
          definitionsState={data.definitionsState}
          executionsState={data.executionsState}
          failure={data.failures[0]?.message}
        />
      </div>
    </>
  );
}
