import Link from "next/link";
import type { Route } from "next";
import type { ClaudeOverviewSnapshot } from "@/contracts/claude-overview";
import { PageHeader } from "@/components/page-header";
import { SourceState } from "@/components/source-state";
import { claudeHref } from "@/lib/claude-navigation";
import { formatShanghaiTime } from "@/lib/time";

export function ClaudeOverview({ snapshot }: { snapshot: ClaudeOverviewSnapshot }) {
  const { project, sessions, system, files } = snapshot;
  return (
    <div className="page-wrap">
      <PageHeader
        title="Overview"
        description={`Return to recent work in ${project.name}, or inspect its current guidance and files.`}
        observedAt={formatShanghaiTime(snapshot.observedAt)}
        mode="CLAUDE CODE / READ ONLY"
      />
      <div className="claude-overview-grid">
        <section className="preview-pane">
          <h2>Recent conversations</h2>
          {sessions ? (
            sessions.items.length ? (
              <ul className="index-list">
                {sessions.items.map((session) => (
                  <li key={session.id}>
                    <Link
                      className="index-row"
                      prefetch={false}
                      href={
                        claudeHref("conversations", project.id, { session: session.id }) as Route
                      }
                    >
                      <span>
                        <strong>{session.title ?? "Untitled session"}</strong>
                        {session.preview ? <small>{session.preview}</small> : null}
                        <small>
                          File updated /{" "}
                          {session.updatedAt ? formatShanghaiTime(session.updatedAt) : "Unknown"}
                        </small>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <SourceState kind="empty" detail="No saved sessions were found in this project." />
            )
          ) : (
            <SourceState kind="error" detail="Saved conversations could not be read." />
          )}
          <Link prefetch={false} href={claudeHref("conversations", project.id) as Route}>
            Browse conversations
          </Link>
          {sessions?.limited ? (
            <p className="truncation-note">Session inventory is partial.</p>
          ) : null}
        </section>
        <section className="preview-pane">
          <h2>Current system</h2>
          {system ? (
            <>
              <dl className="claude-system-counts">
                {Object.entries(system.counts).map(([category, count]) => (
                  <div key={category}>
                    <dt>{category}</dt>
                    <dd>{count}</dd>
                  </div>
                ))}
              </dl>
              {system.limited || system.unavailable ? (
                <p className="truncation-note">
                  Some sources are unavailable or outside this bounded reading.
                </p>
              ) : null}
            </>
          ) : (
            <SourceState kind="error" detail="Current system sources could not be read." />
          )}
          <Link prefetch={false} href={claudeHref("system", project.id) as Route}>
            Inspect System
          </Link>
          <p className="truncation-note">
            Discovered current files; this does not reconstruct what a past session loaded.
          </p>
        </section>
        <section className="preview-pane">
          <h2>Workspace files</h2>
          {files ? (
            <p>
              {files.entries}
              {files.limited ? "+" : ""} visible entries at the approved root.
            </p>
          ) : (
            <SourceState kind="error" detail="The approved workspace could not be read." />
          )}
          <Link prefetch={false} href={claudeHref("files", project.id) as Route}>
            Browse Files
          </Link>
        </section>
      </div>
    </div>
  );
}
