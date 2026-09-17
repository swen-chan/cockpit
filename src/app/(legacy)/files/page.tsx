import { PageHeader } from "@/components/page-header";
import { FileBrowser } from "@/features/files/file-browser";
import { formatShanghaiTime } from "@/lib/time";
import { requireLegacyPageOrRedirect } from "@/server/panels/page-routing";
import { loadFilesPageData } from "@/server/services/files";

export default async function FilesPage() {
  await requireLegacyPageOrRedirect("files");
  const data = await loadFilesPageData();
  return (
    <div className="page-wrap">
      <PageHeader
        title="Files"
        description="Browse approved workspace entries with bounded previews and explicit exclusions."
        observedAt={formatShanghaiTime(data.directory.observedAt)}
        mode="LIVE / READ ONLY"
      />
      <FileBrowser
        initialDirectory={data.directory}
        initialDirectoryFailure={data.directoryFailure?.message}
        initialFile={data.initialFile}
        initialPreviewFailure={data.previewFailure?.message}
      />
    </div>
  );
}
