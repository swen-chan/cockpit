import { OverviewDashboard } from "@/features/overview/overview-dashboard";
import { requireLegacyPageOrRedirect } from "@/server/panels/page-routing";
import { loadOverviewSnapshot } from "@/server/services/overview";

export default async function OverviewPage() {
  await requireLegacyPageOrRedirect("overview");
  const snapshot = await loadOverviewSnapshot();
  return <OverviewDashboard snapshot={snapshot} />;
}
