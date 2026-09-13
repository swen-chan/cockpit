import { OverviewDashboard } from "@/features/overview/overview-dashboard";
import { loadOverviewSnapshot } from "@/server/services/overview";

export default async function OverviewPage() {
  const snapshot = await loadOverviewSnapshot();
  return <OverviewDashboard snapshot={snapshot} />;
}
