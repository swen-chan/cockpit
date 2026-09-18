import type { Metadata } from "next";

import { LastPanelCommit } from "@/components/last-panel-commit";
import { PageHeader } from "@/components/page-header";
import { UnsupportedSurface } from "@/components/scoped-surface-state";
import { codexSystemSnapshotSchema } from "@/contracts/codex";
import { CodexSystemBrowser } from "@/features/system/codex-system-browser";
import { SystemBrowser } from "@/features/system/system-browser";
import { formatShanghaiTime } from "@/lib/time";
import { requireScopedPage, scopedPageMetadata } from "@/server/panels/page-routing";
import { loadAgentSystem } from "@/server/services/agents";
import { scopedHermesSystemOptions } from "@/server/services/hermes-scoped";
import { loadSystemPageData } from "@/server/services/system";

type Props = { params: Promise<{ panelId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return scopedPageMetadata((await params).panelId, "system");
}

export default async function AgentSystemPage({ params }: Props) {
  const { panelId } = await params;
  const { panel, supported } = requireScopedPage(panelId, "system");
  if (!supported) return <UnsupportedSurface panel={panel} surface="system" />;
  if (panel.runtime === "codex") {
    const snapshot = codexSystemSnapshotSchema.parse(await loadAgentSystem(panel));
    return (
      <>
        <LastPanelCommit panelId={panel.id} />
        <div className="page-wrap">
          <PageHeader
            title="System"
            description="Inspect current observable guidance without reconstructing historical task context."
            observedAt={formatShanghaiTime(snapshot.observedAt)}
            mode="CODEX / READ ONLY"
          />
          <CodexSystemBrowser snapshot={snapshot} />
        </div>
      </>
    );
  }

  const data = await loadSystemPageData(scopedHermesSystemOptions(panel));
  return (
    <>
      <LastPanelCommit panelId={panel.id} />
      <div className="page-wrap">
        <PageHeader
          title="System"
          description="Inspect the bounded context influencing Hermes, with source and session provenance."
          observedAt={formatShanghaiTime(data.sources[0]?.stamp.observedAt ?? "")}
          mode="HERMES / READ ONLY"
        />
        <SystemBrowser sources={data.sources} panelId={panel.id} />
      </div>
    </>
  );
}
