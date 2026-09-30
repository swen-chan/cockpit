"use client";

import Link from "next/link";
import type { Route } from "next";
import { claudeHref, withClaudeProject } from "@/lib/claude-navigation";
import { ChevronDown, MessageSquareText, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { countMatches, HighlightedText } from "@/components/highlighted-text";
import { SearchField } from "@/components/search-field";
import { SourceLedger } from "@/components/source-ledger";
import { SourceState } from "@/components/source-state";
import { Button } from "@/components/ui/button";
import {
  claudeSessionDetailSchema,
  claudeSessionPageSchema,
  type ClaudeSessionDetail,
  type ClaudeSessionPage,
} from "@/contracts/claude";
import { cn } from "@/lib/cn";
import {
  isCurrentPanelLocation,
  parseScopedFailure,
  parseScopedPayload,
  scopedApiPath,
} from "@/lib/scoped-client";
import { formatShanghaiTime } from "@/lib/time";

const PANEL_ID = "claude-code" as const;
const issueLabels = {
  too_large: "Exceeds the read limit",
  malformed: "Record could not be read",
  unavailable: "Source unavailable",
};
const activityLabels = {
  result_recorded: "Result recorded",
  recorded_error: "Recorded error",
  no_result_recorded: "No result recorded",
};

function ToolActivity({
  activities,
  projectId,
  sessionId,
}: {
  activities: ClaudeSessionDetail["activities"];
  projectId: string;
  sessionId: string;
}) {
  if (!activities.length) return null;
  const errors = activities.filter((activity) => activity.state === "recorded_error").length;
  const missing = activities.filter((activity) => activity.state === "no_result_recorded").length;
  return (
    <details className="claude-activity-disclosure process-disclosure">
      <summary className="process-summary">
        <span className="claude-activity-heading">
          <span>Tool activity / {activities.length}</span>
          {errors ? <span className="claude-recorded-error">Recorded error / {errors}</span> : null}
          {missing ? <span>No result recorded / {missing}</span> : null}
        </span>
        <ChevronDown aria-hidden="true" size={16} />
      </summary>
      <div className="claude-activity-body">
        <ol className="claude-activity-list">
          {activities.map((activity) => (
            <li key={activity.key}>
              <div className="claude-operation">
                <strong>{activity.label}</strong>
                {activity.command ? <code>{activity.command}</code> : null}
                {activity.filePath ? (
                  <Link
                    prefetch={false}
                    href={
                      claudeHref("files", projectId, {
                        path: activity.filePath,
                        session: sessionId,
                        ...(activity.messageKey ? { message: activity.messageKey } : {}),
                      }) as Route
                    }
                  >
                    Open file
                  </Link>
                ) : null}
                {activity.result ? (
                  <details className="claude-result">
                    <summary>Recorded result</summary>
                    <pre>{activity.result.text}</pre>
                    {activity.result.truncated ? (
                      <p className="truncation-note">Result excerpt is bounded.</p>
                    ) : null}
                  </details>
                ) : null}
              </div>
              <span
                className={
                  activity.state === "recorded_error" ? "claude-recorded-error" : undefined
                }
              >
                {activityLabels[activity.state]}
              </span>
            </li>
          ))}
        </ol>
        <details className="claude-activity-notes">
          <summary>Meaning of these records</summary>
          <p>
            A recorded result does not establish task success. Errors are recorded tool errors; a
            missing result does not indicate whether the tool is still running. Only selected
            operation details are shown. File previews show current content; thinking is omitted.
          </p>
        </details>
      </div>
    </details>
  );
}

export function ClaudeSessionBrowser({
  initialPage,
  projectId,
  initialDetail = null,
  initialSessionId,
  initialFailure,
}: {
  initialPage: ClaudeSessionPage;
  projectId: string;
  initialDetail?: ClaudeSessionDetail | null;
  initialSessionId?: string | undefined;
  initialFailure?: string | undefined;
}) {
  const [sessions, setSessions] = useState(initialPage.items);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [pageObservedAt, setPageObservedAt] = useState(initialPage.observedAt);
  const [pageLimited, setPageLimited] = useState(initialPage.limited);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageFailure, setPageFailure] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSessionId ?? initialDetail?.id ?? null,
  );
  const [detail, setDetail] = useState<ClaudeSessionDetail | null>(initialDetail);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailFailure, setDetailFailure] = useState<string | null>(initialFailure ?? null);
  const [query, setQuery] = useState("");
  const [listQuery, setListQuery] = useState("");
  const pageRequest = useRef<AbortController | null>(null);
  const detailRequest = useRef<AbortController | null>(null);
  const detailTitleRef = useRef<HTMLHeadingElement>(null);
  const paginationStatusRef = useRef<HTMLParagraphElement>(null);
  const shouldRevealDetail = useRef(false);
  const selectedSummary = sessions.find((session) => session.id === selectedId);
  const title = detail?.title ?? selectedSummary?.title ?? "Untitled session";
  const searchableText = detail?.messages.map((message) => message.content).join("\n") ?? "";
  const matches = countMatches(searchableText, query);
  const normalizedListQuery = listQuery.trim().toLocaleLowerCase();
  const matchingSessions = sessions.filter((session) =>
    `${session.title ?? ""}\n${session.preview ?? ""}\n${session.directoryName ?? ""}\n${session.gitBranch ?? ""}`
      .toLocaleLowerCase()
      .includes(normalizedListQuery),
  );

  useEffect(
    () => () => {
      pageRequest.current?.abort();
      detailRequest.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (!shouldRevealDetail.current) return;
    shouldRevealDetail.current = false;
    detailTitleRef.current?.focus({ preventScroll: true });
    detailTitleRef.current?.scrollIntoView?.({ block: "start" });
  }, [selectedId]);

  useEffect(() => {
    if (!detail || !/^#message-[1-9][0-9]*$/u.test(window.location.hash)) return;
    const message = document.getElementById(window.location.hash.slice(1));
    if (!message) return;
    const activity = message.querySelector("details");
    if (activity) activity.open = true;
    message.focus({ preventScroll: true });
    message.scrollIntoView?.({ block: "start" });
  }, [detail]);

  async function loadSession(session: { id: string }): Promise<void> {
    if (pageLoading) return;
    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    const stacked = window.matchMedia("(max-width: 767px)").matches;
    shouldRevealDetail.current = stacked && session.id !== selectedId;
    if (stacked && session.id === selectedId) {
      detailTitleRef.current?.focus({ preventScroll: true });
      detailTitleRef.current?.scrollIntoView?.({ block: "start" });
    }
    setSelectedId(session.id);
    window.history.replaceState(
      null,
      "",
      claudeHref("conversations", projectId, { session: session.id }),
    );
    setDetail(null);
    setDetailLoading(true);
    setDetailFailure(null);
    setQuery("");
    let failureMessage = "The selected session could not be safely loaded.";
    try {
      const response = await fetch(
        withClaudeProject(
          scopedApiPath(PANEL_ID, `/conversations/${encodeURIComponent(session.id)}`),
          projectId,
        ),
        { cache: "no-store", signal: controller.signal },
      );
      const payload: unknown = await response.json();
      const parsed = parseScopedPayload(payload, PANEL_ID, claudeSessionDetailSchema);
      if (!response.ok || !parsed || parsed.id !== session.id) {
        failureMessage = parseScopedFailure(payload, PANEL_ID)?.message ?? failureMessage;
        throw new Error("safe session response rejected");
      }
      if (controller.signal.aborted || !isCurrentPanelLocation(PANEL_ID, projectId)) return;
      setDetail(parsed);
    } catch {
      if (controller.signal.aborted || !isCurrentPanelLocation(PANEL_ID, projectId)) return;
      setDetailFailure(failureMessage);
    } finally {
      if (!controller.signal.aborted && isCurrentPanelLocation(PANEL_ID, projectId))
        setDetailLoading(false);
    }
  }

  async function loadMore(): Promise<void> {
    if (!nextCursor || pageLoading || detailLoading) return;
    pageRequest.current?.abort();
    const controller = new AbortController();
    pageRequest.current = controller;
    setPageLoading(true);
    setPageFailure(null);
    let failureMessage = "More sessions could not be safely loaded.";
    try {
      const response = await fetch(
        withClaudeProject(
          scopedApiPath(
            PANEL_ID,
            `/conversations?cursor=${encodeURIComponent(nextCursor)}${detail ? `&session=${encodeURIComponent(detail.id)}` : ""}`,
          ),
          projectId,
        ),
        { cache: "no-store", signal: controller.signal },
      );
      const payload: unknown = await response.json();
      const parsed = parseScopedPayload(payload, PANEL_ID, claudeSessionPageSchema);
      if (!response.ok || !parsed) {
        failureMessage = parseScopedFailure(payload, PANEL_ID)?.message ?? failureMessage;
        throw new Error("safe session page rejected");
      }
      if (controller.signal.aborted || !isCurrentPanelLocation(PANEL_ID, projectId)) return;
      setSessions((current) => [...current, ...parsed.items]);
      setNextCursor(parsed.nextCursor);
      setPageObservedAt(parsed.observedAt);
      setPageLimited(parsed.limited);
      if (!parsed.nextCursor) queueMicrotask(() => paginationStatusRef.current?.focus());
    } catch {
      if (controller.signal.aborted || !isCurrentPanelLocation(PANEL_ID, projectId)) return;
      setPageFailure(failureMessage);
    } finally {
      if (!controller.signal.aborted && isCurrentPanelLocation(PANEL_ID, projectId))
        setPageLoading(false);
    }
  }

  const updatedAt = detail?.updatedAt ?? selectedSummary?.updatedAt;
  const ledger = [
    { label: "Source scope", value: initialPage.scope },
    { label: "Coverage", value: "Saved top-level sessions; subagent transcripts are excluded." },
    ...(detail?.directoryName
      ? [{ label: "Recorded directory", value: detail.directoryName }]
      : []),
    ...(detail?.gitBranch ? [{ label: "Recorded branch", value: detail.gitBranch }] : []),
    {
      label: "Observed",
      value: formatShanghaiTime(detail?.observedAt ?? pageObservedAt),
      mono: true,
    },
    ...(selectedSummary
      ? [
          {
            label: "File updated",
            value: updatedAt ? formatShanghaiTime(updatedAt) : "Unknown",
            mono: true,
          },
        ]
      : []),
    { label: "Reading", value: "File times do not indicate whether Claude Code is running." },
    {
      label: "Context",
      value: "Directory names and branches come from saved records, not the current checkout.",
    },
  ];
  const unassignedActivities =
    detail?.activities.filter((activity) => activity.messageKey === null) ?? [];

  return (
    <div className="inspection-grid claude-session-grid">
      <section
        className="index-pane conversation-index-pane"
        aria-label="Claude Code session index"
        aria-busy={pageLoading}
      >
        <div className="pane-label">
          SAVED SESSIONS / {sessions.length.toString().padStart(2, "0")}
          {nextCursor ? "+" : ""}
        </div>
        <div className="task-index-state">
          <SearchField
            label="Search loaded sessions"
            value={listQuery}
            onChange={setListQuery}
            resultCount={matchingSessions.length}
          />
        </div>
        <div className="conversation-list-scroll">
          {matchingSessions.length ? (
            <ul className="index-list conversation-list claude-session-list">
              {matchingSessions.map((session) => (
                <li key={session.id}>
                  <button
                    type="button"
                    className={cn(
                      "index-row conversation-row",
                      session.id === selectedId && "is-selected",
                    )}
                    onClick={() => void loadSession(session)}
                    aria-pressed={session.id === selectedId}
                    disabled={pageLoading}
                  >
                    <MessageSquareText aria-hidden="true" size={16} />
                    <span>
                      <strong>
                        <HighlightedText
                          text={session.title ?? "Untitled session"}
                          query={listQuery}
                        />
                      </strong>
                      {session.preview ? (
                        <small>
                          <HighlightedText text={session.preview} query={listQuery} />
                        </small>
                      ) : null}
                      {session.directoryName ? (
                        <small className="claude-session-context">
                          Recorded directory /{" "}
                          <HighlightedText text={session.directoryName} query={listQuery} />
                        </small>
                      ) : null}
                      {session.gitBranch ? (
                        <small className="claude-session-context">
                          Recorded branch /{" "}
                          <HighlightedText text={session.gitBranch} query={listQuery} />
                        </small>
                      ) : null}
                      <em>
                        File updated /{" "}
                        {session.updatedAt ? formatShanghaiTime(session.updatedAt) : "Unknown"}
                      </em>
                      {session.issue ? <small>{issueLabels[session.issue]}</small> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="task-index-state">
              <SourceState
                kind="empty"
                {...(sessions.length
                  ? {
                      title: "No matching sessions",
                      detail:
                        "Search covers loaded titles, previews, recorded directory names, and branches. Change the search or load more sessions when available.",
                    }
                  : { detail: "No saved sessions were found in the configured directory." })}
              />
            </div>
          )}
        </div>
        <footer className="conversation-list-footer">
          {nextCursor ? (
            <Button
              className="show-more"
              disabled={pageLoading || detailLoading}
              aria-busy={pageLoading}
              onClick={() => void loadMore()}
            >
              {pageLoading ? "Loading…" : "Show more"}
            </Button>
          ) : null}
          <p
            className="conversation-pagination-note"
            ref={paginationStatusRef}
            role="status"
            aria-live="polite"
            tabIndex={-1}
          >
            {pageFailure
              ? `${pageFailure} ${sessions.length} sessions remain loaded.`
              : pageLoading
                ? `Loading older sessions. ${sessions.length} sessions remain visible.`
                : `${sessions.length} sessions loaded.${nextCursor ? " Load older sessions as needed." : " End of this directory reading."}`}
          </p>
          {pageLimited ? (
            <p className="truncation-note">
              Directory scan limit reached. This is a partial inventory.
            </p>
          ) : null}
        </footer>
      </section>

      <article
        className="preview-pane transcript-pane claude-session-detail"
        aria-label={selectedId ? undefined : "Session detail"}
        aria-labelledby={selectedId ? "claude-session-title" : undefined}
        aria-busy={detailLoading}
      >
        {selectedId ? (
          <>
            <div className="preview-toolbar task-detail-toolbar">
              <div>
                <p className="eyebrow">SAVED CONVERSATION</p>
                <h2 id="claude-session-title" ref={detailTitleRef} tabIndex={-1}>
                  {title}
                </h2>
              </div>
              <Button
                size="small"
                className="task-refresh"
                disabled={detailLoading || pageLoading}
                onClick={() => void loadSession({ id: selectedId })}
              >
                <RefreshCw aria-hidden="true" size={13} />
                Refresh session
              </Button>
            </div>
            {detailLoading ? (
              <SourceState kind="loading" detail="Reading the selected saved conversation." />
            ) : null}
            {detailFailure ? <SourceState kind="error" detail={detailFailure} /> : null}
            {detail ? (
              <>
                <p className="preview-summary">Saved conversation as read. Most recent first.</p>
                <SearchField
                  label="Search loaded conversation"
                  value={query}
                  onChange={setQuery}
                  resultCount={matches}
                />
                {detail.pendingWrite ? (
                  <p className="truncation-note">
                    The source changed or ended with an unfinished record. Refresh to read it again.
                  </p>
                ) : null}
                {detail.limited ? (
                  <p className="truncation-note">
                    Display limit reached. This reading shows bounded recent text and tool activity.
                  </p>
                ) : null}
                {detail.messages.length ? (
                  <ol className="transcript-list" key={detail.id}>
                    {detail.messages.toReversed().map((message) => (
                      <li
                        id={message.key}
                        tabIndex={-1}
                        key={message.key}
                        className={cn("message", `message-${message.role}`)}
                      >
                        <header>
                          <span>
                            {message.role === "summary"
                              ? "Compaction summary"
                              : message.content === null
                                ? "Tool activity"
                                : message.role}
                          </span>
                          {message.timestamp ? (
                            <time dateTime={message.timestamp}>
                              {formatShanghaiTime(message.timestamp)}
                            </time>
                          ) : null}
                        </header>
                        {message.content !== null ? (
                          <p>
                            <HighlightedText text={message.content} query={query} />
                          </p>
                        ) : null}
                        <ToolActivity
                          projectId={projectId}
                          sessionId={detail.id}
                          activities={detail.activities.filter(
                            (activity) => activity.messageKey === message.key,
                          )}
                        />
                      </li>
                    ))}
                  </ol>
                ) : (
                  <SourceState
                    kind="empty"
                    detail="This saved conversation contains no displayable text."
                  />
                )}
                {unassignedActivities.length ? (
                  <section className="claude-unassigned-activity" key={detail.id}>
                    <h3>Context not displayed</h3>
                    <p className="truncation-note">
                      These tool records belong to messages outside the displayed conversation.
                    </p>
                    <ToolActivity
                      activities={unassignedActivities}
                      projectId={projectId}
                      sessionId={detail.id}
                    />
                  </section>
                ) : null}
              </>
            ) : null}
          </>
        ) : (
          <div className="task-detail-placeholder">
            <SourceState
              kind="empty"
              title="Select a session"
              detail="Choose a saved session to read its conversation and optional tool activity."
            />
          </div>
        )}
        <details
          className="claude-source-disclosure process-disclosure"
          key={selectedId ?? "source"}
        >
          <summary className="process-summary">
            <span>Source details</span>
            <ChevronDown aria-hidden="true" size={16} />
          </summary>
          <SourceLedger title="Session source" items={ledger} />
        </details>
      </article>
    </div>
  );
}
