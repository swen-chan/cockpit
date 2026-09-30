import type { Metadata } from "next";
import { Suspense } from "react";

import { agentSurfaceSchema } from "@/contracts/agents";
import { ClaudeSessionBrowser } from "@/components/claude-session-browser";
import { claudePageQuery, type ClaudePageSearch } from "@/server/claude/page-query";
import { readClaudeSessionPage, readClaudeSession } from "@/server/claude/reader";
import { LastPanelCommit } from "@/components/last-panel-commit";
import { PageHeader } from "@/components/page-header";
import { UnsupportedSurface } from "@/components/scoped-surface-state";
import { SourceState } from "@/components/source-state";
import { CodexTaskBrowser } from "@/features/conversations/codex-task-browser";
import { ConversationBrowser } from "@/features/conversations/conversation-browser";
import { formatShanghaiTime } from "@/lib/time";
import { requireScopedPage, scopedPageMetadata } from "@/server/panels/page-routing";
import type { ClaudePanelDescriptor, CodexPanelDescriptor } from "@/server/panels/registry";
import { logSafeDiagnostic, toSafeDiagnostic } from "@/server/security/errors";
import { loadCodexTaskPage } from "@/server/services/codex-tasks";
import { loadConversationPageData } from "@/server/services/conversations";
import { scopedHermesConversationOptions } from "@/server/services/hermes-scoped";

type Props = {
  params: Promise<{ panelId: string }>;
  searchParams?: Promise<ClaudePageSearch>;
};

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

function ClaudeConversationsHeader({ observedAt }: { observedAt: string }) {
  return (
    <PageHeader
      title="Conversations"
      description="Inspect saved Claude Code conversations in the configured session directory."
      observedAt={formatShanghaiTime(observedAt)}
      mode="CLAUDE CODE / READ ONLY PREVIEW"
    />
  );
}

async function ClaudeConversationsSurface({
  panel,
  fallbackFrom,
  projectId,
  sessionId,
}: {
  panel: ClaudePanelDescriptor;
  projectId: string;
  sessionId?: string | undefined;
  fallbackFrom?: string | undefined;
}) {
  let page: Awaited<ReturnType<typeof readClaudeSessionPage>> | null = null;
  let failure: ReturnType<typeof toSafeDiagnostic> | null = null;
  let initialDetail = null;
  let detailFailure: string | undefined;
  try {
    page = await readClaudeSessionPage(panel, null, projectId);
  } catch (error) {
    failure = toSafeDiagnostic(error, "claude-conversations");
    logSafeDiagnostic({ ...failure, panelId: panel.id });
  }
  if (failure)
    return (
      <div className="page-wrap">
        <ClaudeConversationsHeader observedAt={failure.observedAt} />
        <SourceState kind="error" detail={failure.message} />
      </div>
    );
  if (!page) throw new Error("Claude conversations did not resolve a safe state.");
  if (sessionId) {
    try {
      initialDetail = await readClaudeSession(panel, sessionId, projectId);
    } catch (error) {
      detailFailure = toSafeDiagnostic(error, "claude-conversations").message;
    }
  }
  return (
    <div className="page-wrap">
      <ClaudeConversationsHeader observedAt={page.observedAt} />
      {fallbackFrom ? (
        <p className="scope-fallback-notice">
          {fallbackFrom} is not supported by Claude Code. Opened Conversations instead.
        </p>
      ) : null}
      <ClaudeSessionBrowser
        key={`${projectId}:${sessionId ?? ""}`}
        projectId={projectId}
        initialPage={page}
        initialDetail={initialDetail}
        initialSessionId={sessionId}
        initialFailure={detailFailure}
      />
    </div>
  );
}

export default async function AgentConversationsPage({ params, searchParams }: Props) {
  const { panelId } = await params;
  const context = requireScopedPage(panelId, "conversations");
  if (context.state !== "ready") return null;
  const { panel, supported } = context;
  if (!supported) return <UnsupportedSurface panel={panel} surface="conversations" />;
  if (panel.runtime === "claude-code") {
    const query = await searchParams;
    const { project, session } = claudePageQuery(panel, query);
    const from = agentSurfaceSchema.safeParse(query?.from);
    const fallbackFrom =
      from.success && !panel.surfaces.includes(from.data)
        ? from.data[0]!.toUpperCase() + from.data.slice(1)
        : undefined;
    return (
      <>
        <LastPanelCommit panelId={panel.id} />
        <Suspense
          fallback={
            <div className="page-wrap">
              <ClaudeConversationsHeader observedAt={new Date().toISOString()} />
              <SourceState kind="loading" detail="Reading saved Claude Code conversations." />
            </div>
          }
        >
          <ClaudeConversationsSurface
            panel={panel}
            projectId={project.id}
            sessionId={session}
            fallbackFrom={fallbackFrom}
          />
        </Suspense>
      </>
    );
  }
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
