import type { Metadata } from "next";
import { Suspense } from "react";

import { LastPanelCommit } from "@/components/last-panel-commit";
import { PageHeader } from "@/components/page-header";
import { UnsupportedSurface } from "@/components/scoped-surface-state";
import { SourceState } from "@/components/source-state";
import { CodexTaskBrowser } from "@/features/conversations/codex-task-browser";
import { ConversationBrowser } from "@/features/conversations/conversation-browser";
import { formatShanghaiTime } from "@/lib/time";
import { requireScopedPage, scopedPageMetadata } from "@/server/panels/page-routing";
import type { CodexPanelDescriptor } from "@/server/panels/registry";
import { logSafeDiagnostic, toSafeDiagnostic } from "@/server/security/errors";
import { loadCodexTaskPage } from "@/server/services/codex-tasks";
import { loadConversationPageData } from "@/server/services/conversations";
import { scopedHermesConversationOptions } from "@/server/services/hermes-scoped";

type Props = { params: Promise<{ panelId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return scopedPageMetadata((await params).panelId, "conversations");
}

function CodexTasksLoading() {
  const observedAt = new Date().toISOString();
  return (
    <div className="page-wrap">
      <PageHeader
        title="Tasks"
        description="Inspect the bounded task history indexed in the Codex state database."
        observedAt={formatShanghaiTime(observedAt)}
        mode="CODEX / READ ONLY"
      />
      <SourceState kind="loading" detail="Reading the bounded Codex task index." />
    </div>
  );
}

async function CodexTasksSurface({ panel }: { panel: CodexPanelDescriptor }) {
  let page: Awaited<ReturnType<typeof loadCodexTaskPage>> | null = null;
  let failure: ReturnType<typeof toSafeDiagnostic> | null = null;
  try {
    page = await loadCodexTaskPage(panel);
  } catch (error) {
    failure = toSafeDiagnostic(error, "codex-tasks");
    logSafeDiagnostic({ ...failure, panelId: panel.id });
  }

  if (failure) {
    return (
      <div className="page-wrap">
        <PageHeader
          title="Tasks"
          description="Inspect the bounded task history indexed in the Codex state database."
          observedAt={formatShanghaiTime(failure.observedAt)}
          mode="CODEX / READ ONLY"
        />
        <SourceState kind="error" detail={failure.message} />
      </div>
    );
  }

  if (!page) throw new Error("Codex Tasks page did not resolve a safe state.");
  return (
    <div className="page-wrap">
      <PageHeader
        title="Tasks"
        description="Inspect the bounded task history indexed in the Codex state database."
        observedAt={formatShanghaiTime(page.observedAt)}
        mode="CODEX / READ ONLY"
      />
      <CodexTaskBrowser initialPage={page} />
    </div>
  );
}

export default async function AgentConversationsPage({ params }: Props) {
  const { panelId } = await params;
  const { panel, supported } = requireScopedPage(panelId, "conversations");
  if (!supported) return <UnsupportedSurface panel={panel} surface="conversations" />;
  if (panel.runtime === "codex") {
    return (
      <>
        <LastPanelCommit panelId={panel.id} />
        <Suspense fallback={<CodexTasksLoading />}>
          <CodexTasksSurface panel={panel} />
        </Suspense>
      </>
    );
  }

  const data = await loadConversationPageData(scopedHermesConversationOptions(panel));
  return (
    <>
      <LastPanelCommit panelId={panel.id} />
      <div className="page-wrap">
        <PageHeader
          title="Conversations"
          description="Read normal interactive transcripts; cron, hidden, and archived sessions are excluded."
          observedAt={formatShanghaiTime(data.page.observedAt)}
          mode="HERMES / READ ONLY"
        />
        <ConversationBrowser
          initialPage={data.page}
          initialConversation={data.initialConversation}
          initialFailure={data.failure?.message}
          panelId={panel.id}
        />
      </div>
    </>
  );
}
