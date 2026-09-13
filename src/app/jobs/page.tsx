import { PageHeader } from "@/components/page-header";
import { JobsBrowser } from "@/features/jobs/jobs-browser";
import { formatShanghaiTime } from "@/lib/time";
import { loadJobsPageData } from "@/server/services/jobs";

export default async function JobsPage() {
  const data = await loadJobsPageData();
  return (
    <div className="page-wrap">
      <PageHeader
        title="Jobs"
        description="Inspect schedules and recent execution metadata without exposing controls or job payloads."
        observedAt={formatShanghaiTime(data.observedAt)}
        mode="LIVE / READ ONLY"
      />
      <JobsBrowser
        jobs={data.jobs}
        definitionsState={data.definitionsState}
        executionsState={data.executionsState}
        failure={data.failures[0]?.message}
      />
    </div>
  );
}
