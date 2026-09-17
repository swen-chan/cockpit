import { PageHeader } from "@/components/page-header";
import { SystemBrowser } from "@/features/system/system-browser";
import { formatShanghaiTime } from "@/lib/time";
import { requireLegacyPageOrRedirect } from "@/server/panels/page-routing";
import { loadSystemPageData } from "@/server/services/system";

export default async function SystemPage() {
  await requireLegacyPageOrRedirect("system");
  const data = await loadSystemPageData();
  return (
    <div className="page-wrap">
      <PageHeader
        title="System"
        description="Inspect the bounded context influencing Hermes, with source and session provenance."
        observedAt={formatShanghaiTime(data.sources[0]?.stamp.observedAt ?? "")}
        mode="LIVE / READ ONLY"
      />
      <SystemBrowser sources={data.sources} />
    </div>
  );
}
