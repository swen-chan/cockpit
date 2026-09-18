import type { Metadata } from "next";

import { LastPanelCommit } from "@/components/last-panel-commit";
import { PageHeader } from "@/components/page-header";
import { UnsupportedSurface } from "@/components/scoped-surface-state";
import { FileBrowser } from "@/features/files/file-browser";
import { formatShanghaiTime } from "@/lib/time";
import { requireScopedPage, scopedPageMetadata } from "@/server/panels/page-routing";
import { loadFilesPageData } from "@/server/services/files";
import { scopedHermesFilesOptions } from "@/server/services/hermes-scoped";

type Props = { params: Promise<{ panelId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return scopedPageMetadata((await params).panelId, "files");
}

export default async function AgentFilesPage({ params }: Props) {
  const { panelId } = await params;
  const { panel, supported } = requireScopedPage(panelId, "files");
  if (!supported) return <UnsupportedSurface panel={panel} surface="files" />;
  if (panel.runtime === "codex") {
    const workspaceRoot = panel.configuration.workspaceRoot;
    if (!workspaceRoot) return <UnsupportedSurface panel={panel} surface="files" />;
    const data = await loadFilesPageData({ workspaceRoot });
    return (
      <>
        <LastPanelCommit panelId={panel.id} />
        <div className="page-wrap">
          <PageHeader
            title="Files"
            description="Browse the explicitly approved Codex workspace with bounded previews and exclusions."
            observedAt={formatShanghaiTime(data.directory.observedAt)}
            mode="CODEX / READ ONLY"
          />
          <FileBrowser
            initialDirectory={data.directory}
            initialDirectoryFailure={data.directoryFailure?.message}
            initialFile={data.initialFile}
            initialPreviewFailure={data.previewFailure?.message}
            panelId={panel.id}
          />
        </div>
      </>
    );
  }

  const data = await loadFilesPageData(scopedHermesFilesOptions(panel));
  return (
    <>
      <LastPanelCommit panelId={panel.id} />
      <div className="page-wrap">
        <PageHeader
          title="Files"
          description="Browse approved workspace entries with bounded previews and explicit exclusions."
          observedAt={formatShanghaiTime(data.directory.observedAt)}
          mode="HERMES / READ ONLY"
        />
        <FileBrowser
          initialDirectory={data.directory}
          initialDirectoryFailure={data.directoryFailure?.message}
          initialFile={data.initialFile}
          initialPreviewFailure={data.previewFailure?.message}
          panelId={panel.id}
        />
      </div>
    </>
  );
}
