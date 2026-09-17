import {
  Activity,
  ArrowUpRight,
  CalendarClock,
  Database,
  FileText,
  MessagesSquare,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { SectionHeading } from "@/components/section-heading";
import { SourceState } from "@/components/source-state";
import { StatusLabel } from "@/components/status-label";
import type { OverviewSectionStatus, OverviewSnapshot } from "@/contracts/cockpit";
import { formatShanghaiTime } from "@/lib/time";

function sectionFailure(section: OverviewSectionStatus) {
  if (section.state === "ready") return null;
  return (
    <SourceState kind={section.state} {...(section.message ? { detail: section.message } : {})} />
  );
}

function observedDetail(observedAt: string): string {
  return `Observed ${formatShanghaiTime(observedAt)}`;
}

export function OverviewDashboard({
  basePath = "",
  snapshot,
}: {
  basePath?: string;
  snapshot: OverviewSnapshot;
}) {
  const { conversations, jobs, profile, system, workspace } = snapshot;
  const surfaceHref = (surface: "conversations" | "files" | "jobs" | "system"): Route =>
    `${basePath}/${surface}` as Route;
  const conversationCount =
    conversations.state === "ready"
      ? `${conversations.items.length}${conversations.hasMore ? "+" : ""}`
      : "—";
  const workspaceCount =
    workspace.loadedCount === null
      ? "Unavailable"
      : workspace.truncated
        ? `${workspace.loadedCount} shown / partial`
        : `${workspace.loadedCount} visible entries`;
  const modelAvailable = profile.state === "ready" && profile.configState === "ready";
  const statusItems = [
    {
      label: "Profile",
      value: profile.state === "ready" ? profile.profile : "Unavailable",
      detail:
        profile.state === "ready"
          ? profile.homeLabel
          : (profile.message ?? "Hermes home unavailable"),
    },
    {
      label: "Model / provider",
      value: modelAvailable ? (profile.model ?? "Not configured") : "Unavailable",
      detail: modelAvailable
        ? (profile.provider ?? "Provider not configured")
        : profile.configState === "error"
          ? "Config read failed"
          : "Config unavailable",
    },
    {
      label: "Conversations",
      value: conversationCount,
      detail:
        conversations.state === "ready"
          ? `${formatShanghaiTime(conversations.observedAt, true)} observed`
          : (conversations.message ?? "Source unavailable"),
    },
    {
      label: "Enabled jobs",
      value: jobs.enabled === null ? "—" : String(jobs.enabled),
      detail:
        jobs.total === null
          ? (jobs.message ?? "Definitions unavailable")
          : `${jobs.total} total · ${jobs.paused ?? 0} paused`,
    },
    {
      label: "Files",
      value: workspace.state === "ready" ? formatShanghaiTime(workspace.observedAt, true) : "—",
      detail:
        workspace.state === "ready"
          ? `Approved workspace · ${workspaceCount}`
          : (workspace.message ?? "Source unavailable"),
    },
  ];

  return (
    <div className="page-wrap">
      <PageHeader
        title="Overview"
        description="A source-aware register of Hermes state, assembled without changing it."
        observedAt={formatShanghaiTime(snapshot.observedAt)}
        mode="LIVE / READ ONLY"
      />
      <section className="status-register" aria-label="Hermes status register">
        {statusItems.map((item, index) => (
          <div key={item.label}>
            <span>
              {String(index + 1).padStart(2, "0")} / {item.label}
            </span>
            <strong>{item.value}</strong>
            <small>{item.detail}</small>
          </div>
        ))}
      </section>
      <div className="overview-grid">
        <section className="overview-primary">
          <SectionHeading
            index="A"
            title="Conversations"
            detail={`Recent activity · ${observedDetail(conversations.observedAt)}`}
          />
          {sectionFailure(conversations) ??
            (conversations.items.length === 0 ? (
              <SourceState kind="empty" detail="No eligible interactive sessions were returned." />
            ) : (
              <div className="register-list">
                {conversations.items.map((conversation) => (
                  <div key={conversation.id} className="register-row overview-register-row">
                    <MessagesSquare aria-hidden="true" size={17} />
                    <span>
                      <strong>{conversation.title}</strong>
                      <small>
                        {conversation.source} · {conversation.preview}
                      </small>
                    </span>
                    <time>{formatShanghaiTime(conversation.lastActivity)}</time>
                  </div>
                ))}
              </div>
            ))}
          <Link
            href={surfaceHref("conversations")}
            className="button button-outline overview-register-link"
          >
            Conversations <ArrowUpRight aria-hidden="true" size={14} />
          </Link>
        </section>
        <section className="overview-secondary">
          <SectionHeading
            index="B"
            title="System"
            detail="Five core sources · independently observed"
          />
          {sectionFailure(system) ?? (
            <div className="context-register">
              {system.items.map((source) => (
                <div key={source.id}>
                  <Database aria-hidden="true" size={15} />
                  <span>
                    <strong>{source.title}</strong>
                    <small>
                      {source.label} · {source.freshnessLabel}{" "}
                      {formatShanghaiTime(source.freshnessAt)}
                    </small>
                  </span>
                  <StatusLabel status={source.state} />
                </div>
              ))}
            </div>
          )}
          <Link
            href={surfaceHref("system")}
            className="button button-outline overview-register-link"
          >
            System <ArrowUpRight aria-hidden="true" size={14} />
          </Link>
        </section>
        <section className="overview-secondary">
          <SectionHeading
            index="C"
            title="Jobs"
            detail={
              jobs.total === null
                ? observedDetail(jobs.observedAt)
                : `${jobs.total} total · ${observedDetail(jobs.observedAt)}`
            }
          />
          {sectionFailure(jobs) ??
            (jobs.total === 0 ? (
              <SourceState
                kind="empty"
                detail="The job source is available but contains no definitions."
              />
            ) : (
              <>
                <dl className="metric-block">
                  <div>
                    <dt>Enabled</dt>
                    <dd>{jobs.enabled}</dd>
                  </div>
                  <div>
                    <dt>Paused</dt>
                    <dd>{jobs.paused}</dd>
                  </div>
                  <div>
                    <dt>Failed last run</dt>
                    <dd>{jobs.failedLastRun}</dd>
                  </div>
                </dl>
                {jobs.executionsState !== "ready" ? (
                  <p className="state-message overview-state-message">
                    <StatusLabel status={jobs.executionsState} label="History partial" />
                    Job definitions remain available.
                  </p>
                ) : null}
                <div className="next-event">
                  <CalendarClock aria-hidden="true" size={18} />
                  <span>
                    <small>NEXT EVENT</small>
                    <strong>{jobs.nextEvent?.name ?? "No scheduled event"}</strong>
                    <em className="mono">
                      {jobs.nextEvent
                        ? formatShanghaiTime(jobs.nextEvent.nextRun)
                        : "No active next-run timestamp"}
                    </em>
                  </span>
                </div>
              </>
            ))}
          <Link href={surfaceHref("jobs")} className="button button-outline overview-register-link">
            Jobs <ArrowUpRight aria-hidden="true" size={14} />
          </Link>
        </section>
        <section className="overview-primary">
          <SectionHeading
            index="D"
            title="Files"
            detail={`Approved workspace · ${workspaceCount} · ${observedDetail(workspace.observedAt)}`}
          />
          {sectionFailure(workspace) ??
            (workspace.items.length === 0 ? (
              <SourceState
                kind="empty"
                detail={
                  workspace.loadedCount === 0
                    ? "The workspace root contains no visible entries."
                    : "The visible root entries contain no files to summarize."
                }
              />
            ) : (
              <>
                <div className="file-strip">
                  {workspace.items.map((file) => (
                    <div key={`${file.name}-${file.modifiedAt}`}>
                      <FileText aria-hidden="true" size={16} />
                      <span>
                        <strong>{file.name}</strong>
                        <small>
                          {file.kind} · {file.size}
                        </small>
                      </span>
                      <time>{formatShanghaiTime(file.modifiedAt)}</time>
                    </div>
                  ))}
                </div>
                {workspace.truncated ? (
                  <p className="state-message">
                    The root listing is partial; counts are not presented as exact.
                  </p>
                ) : null}
              </>
            ))}
          <Link
            href={surfaceHref("files")}
            className="button button-outline overview-register-link"
          >
            Files <ArrowUpRight aria-hidden="true" size={14} />
          </Link>
        </section>
      </div>
      <footer className="fixture-banner">
        <Activity aria-hidden="true" size={16} />
        <span>
          <strong>Live local snapshot</strong> Read-only sources are composed independently and
          retain their own observation times.
        </span>
      </footer>
    </div>
  );
}
