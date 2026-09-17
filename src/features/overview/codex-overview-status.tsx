import { Activity, ArrowUpRight, BookOpenText, Cpu, FileText, ListTodo } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { SectionHeading } from "@/components/section-heading";
import { SourceState } from "@/components/source-state";
import { StatusLabel } from "@/components/status-label";
import type { CodexOverviewSnapshot, CodexTaskSummary } from "@/contracts/codex";
import { panelSurfaceHref } from "@/lib/panel-navigation";
import { formatShanghaiTime } from "@/lib/time";

type OverviewFailure = Extract<
  CodexOverviewSnapshot["runtime"],
  { state: "unavailable" | "error" }
>;

function observedDetail(observedAt: string): string {
  return `Observed ${formatShanghaiTime(observedAt)}`;
}

function projectLabel(task: CodexTaskSummary): string {
  return task.projectLabel ?? "UNKNOWN";
}

function taskTitle(task: CodexTaskSummary): string {
  return task.title ?? "Untitled task";
}

function failureState(section: OverviewFailure) {
  return <SourceState kind={section.state} detail={section.message} />;
}

function guidanceStatus(state: "ready" | "missing" | "unavailable" | "error") {
  if (state === "missing") return <StatusLabel status="unknown" label="missing" />;
  return <StatusLabel status={state} />;
}

export function CodexOverviewStatus({
  fallbackFrom,
  snapshot,
}: {
  fallbackFrom?: string | undefined;
  snapshot: CodexOverviewSnapshot;
}) {
  return (
    <div className="page-wrap">
      <PageHeader
        title="Overview"
        description="A source-aware register of the current Codex runtime, Tasks, guidance, and approved workspace."
        observedAt={formatShanghaiTime(snapshot.observedAt)}
        mode="CODEX / READ ONLY"
      />
      {fallbackFrom ? (
        <p className="scope-fallback-notice">
          {fallbackFrom} is not supported by Codex. Opened Overview instead.
        </p>
      ) : null}

      <section className="status-register" aria-label="Codex status register">
        <div>
          <span>01 / Panel</span>
          <strong>{snapshot.panelName}</strong>
          <small>Selected local Agent panel</small>
        </div>
        <div>
          <span>02 / Runtime</span>
          <strong>
            {snapshot.runtime.state === "ready"
              ? snapshot.runtime.version
              : snapshot.runtime.state === "error"
                ? "Error"
                : "Unavailable"}
          </strong>
          <small>
            {snapshot.runtime.state === "ready" ? snapshot.runtime.label : snapshot.runtime.message}
          </small>
        </div>
        <div>
          <span>03 / Tasks</span>
          <strong>
            {snapshot.tasks.state === "ready"
              ? `${snapshot.tasks.items.length}${snapshot.tasks.hasMore ? "+" : ""}`
              : "—"}
          </strong>
          <small>
            {snapshot.tasks.state === "ready" ? "Recent indexed Tasks" : snapshot.tasks.message}
          </small>
        </div>
        <div>
          <span>04 / Guidance</span>
          <strong>
            {snapshot.guidance.state === "ready"
              ? `${snapshot.guidance.items.filter((source) => source.state === "ready").length} / ${snapshot.guidance.items.length}`
              : "—"}
          </strong>
          <small>
            {snapshot.guidance.state === "ready"
              ? "Ready / observed sources"
              : snapshot.guidance.message}
          </small>
        </div>
        <div>
          <span>05 / Files</span>
          <strong>
            {snapshot.workspace.state === "unsupported"
              ? "Not configured"
              : snapshot.workspace.state === "ready"
                ? snapshot.workspace.truncated
                  ? `${snapshot.workspace.loadedCount} shown`
                  : `${snapshot.workspace.loadedCount} visible`
                : "—"}
          </strong>
          <small>
            {snapshot.workspace.state === "unsupported"
              ? snapshot.workspace.message
              : snapshot.workspace.state === "ready"
                ? snapshot.workspace.truncated
                  ? "Approved workspace · partial listing"
                  : "Approved workspace"
                : snapshot.workspace.message}
          </small>
        </div>
      </section>

      <div className="overview-grid">
        <section className="overview-primary">
          <SectionHeading
            index="A"
            title="Tasks"
            detail={
              snapshot.tasks.state === "ready"
                ? `${snapshot.tasks.items.length} recent${snapshot.tasks.hasMore ? " · more available" : ""} · ${observedDetail(snapshot.tasks.observedAt)}`
                : observedDetail(snapshot.tasks.observedAt)
            }
          />
          {snapshot.tasks.state !== "ready" ? (
            failureState(snapshot.tasks)
          ) : snapshot.tasks.items.length === 0 ? (
            <SourceState kind="empty" detail="No indexed Codex Tasks were returned." />
          ) : (
            <div className="register-list" aria-label="Recent Codex Tasks">
              {snapshot.tasks.items.map((task) => (
                <div key={task.id} className="register-row overview-register-row">
                  <ListTodo aria-hidden="true" size={17} />
                  <span>
                    <strong>{taskTitle(task)}</strong>
                    <em className="task-project">
                      <span>PROJECT /</span>
                      <b>{projectLabel(task)}</b>
                    </em>
                    <small>
                      {task.source} · {task.status}
                      {task.preview ? ` · ${task.preview}` : ""}
                    </small>
                  </span>
                  <time {...(task.lastActivity ? { dateTime: task.lastActivity } : {})}>
                    {task.lastActivity ? formatShanghaiTime(task.lastActivity) : "Unknown activity"}
                  </time>
                </div>
              ))}
            </div>
          )}
          <Link
            href={panelSurfaceHref("codex", "conversations")}
            prefetch={false}
            className="button button-outline overview-register-link"
          >
            Tasks <ArrowUpRight aria-hidden="true" size={14} />
          </Link>
        </section>

        <section className="overview-secondary">
          <SectionHeading
            index="B"
            title="Runtime"
            detail={observedDetail(snapshot.runtime.observedAt)}
          />
          {snapshot.runtime.state !== "ready" ? (
            failureState(snapshot.runtime)
          ) : (
            <div className="context-register">
              <div>
                <Cpu aria-hidden="true" size={15} />
                <span>
                  <strong>{snapshot.runtime.label}</strong>
                  <small>Version {snapshot.runtime.version}</small>
                </span>
                <StatusLabel status="ready" />
              </div>
            </div>
          )}
        </section>

        <section className="overview-primary">
          <SectionHeading
            index="C"
            title="Current guidance"
            detail={`Current observable sources · ${observedDetail(snapshot.guidance.observedAt)}`}
          />
          {snapshot.guidance.state !== "ready" ? (
            failureState(snapshot.guidance)
          ) : snapshot.guidance.items.length === 0 ? (
            <SourceState kind="empty" detail="No current guidance sources were observed." />
          ) : (
            <div className="context-register">
              {snapshot.guidance.items.map((source) => (
                <div key={source.label}>
                  <BookOpenText aria-hidden="true" size={15} />
                  <span>
                    <strong>{source.label}</strong>
                    <small>Current observable guidance</small>
                  </span>
                  {guidanceStatus(source.state)}
                </div>
              ))}
            </div>
          )}
          <Link
            href={panelSurfaceHref("codex", "system")}
            prefetch={false}
            className="button button-outline overview-register-link"
          >
            System <ArrowUpRight aria-hidden="true" size={14} />
          </Link>
        </section>

        <section className="overview-secondary">
          <SectionHeading
            index="D"
            title="Files"
            detail={`${snapshot.workspace.state === "unsupported" ? "Not configured" : "Approved workspace"} · ${observedDetail(snapshot.workspace.observedAt)}`}
          />
          {snapshot.workspace.state === "unsupported" ? (
            <SourceState
              kind="unavailable"
              title="Files not configured"
              detail="Codex Files requires an explicitly approved workspace root."
            />
          ) : snapshot.workspace.state !== "ready" ? (
            failureState(snapshot.workspace)
          ) : snapshot.workspace.items.length === 0 ? (
            <SourceState
              kind="empty"
              detail={
                snapshot.workspace.loadedCount === 0
                  ? "The approved workspace contains no visible entries."
                  : "No root-level files were included in this bounded summary."
              }
            />
          ) : (
            <>
              <div className="file-strip">
                {snapshot.workspace.items.map((file) => (
                  <div key={`${file.name}-${file.modifiedAt}`}>
                    <FileText aria-hidden="true" size={16} />
                    <span>
                      <strong>{file.name}</strong>
                      <small>
                        {file.kind} · {file.size}
                      </small>
                    </span>
                    <time dateTime={file.modifiedAt}>{formatShanghaiTime(file.modifiedAt)}</time>
                  </div>
                ))}
              </div>
              {snapshot.workspace.truncated ? (
                <p className="state-message">
                  The approved root listing is partial; counts are not presented as exact.
                </p>
              ) : null}
            </>
          )}
          {snapshot.workspace.state !== "unsupported" ? (
            <Link
              href={panelSurfaceHref("codex", "files")}
              prefetch={false}
              className="button button-outline overview-register-link"
            >
              Files <ArrowUpRight aria-hidden="true" size={14} />
            </Link>
          ) : null}
        </section>
      </div>

      <footer className="fixture-banner">
        <Activity aria-hidden="true" size={16} />
        <span>
          <strong>Current local snapshot</strong>
          Read-only Codex sources are observed independently and may have different timestamps.
        </span>
      </footer>
    </div>
  );
}
