"use client";

import { ListTodo, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { HighlightedText, countMatches } from "@/components/highlighted-text";
import { SearchField } from "@/components/search-field";
import { SourceLedger } from "@/components/source-ledger";
import { SourceState } from "@/components/source-state";
import { StatusLabel } from "@/components/status-label";
import { Button } from "@/components/ui/button";
import type {
  CodexTaskDetail,
  CodexTaskPage,
  CodexTaskSummary,
  OmittedContent,
} from "@/contracts/codex";
import { codexTaskDetailSchema, codexTaskPageSchema } from "@/contracts/codex";
import {
  CodexProcessTimeline,
  visibleProcessSearchText,
} from "@/features/conversations/codex-process-timeline";
import { cn } from "@/lib/cn";
import {
  isCurrentPanelLocation,
  parseScopedFailure,
  parseScopedPayload,
  scopedApiPath,
} from "@/lib/scoped-client";
import { formatShanghaiTime } from "@/lib/time";

const PANEL_ID = "codex" as const;
const MAX_LOADED_TASKS = 25;

type DetailState = "idle" | "loading" | "error";
type PageState = "idle" | "loading" | "error" | "refresh" | "limit";

function taskTitle(task: CodexTaskSummary): string {
  return task.title ?? "Untitled task";
}

function projectLabel(task: CodexTaskSummary): string {
  return task.projectLabel ?? "UNKNOWN";
}

function TaskStatus({ status }: { status: CodexTaskSummary["status"] }) {
  if (status === "active") return <StatusLabel status="running" label="active" />;
  if (status === "idle") return <StatusLabel status="paused" label="idle" />;
  return <StatusLabel status={status} />;
}

function TurnStatus({ status }: { status: CodexTaskDetail["turns"][number]["status"] }) {
  if (status === "in-progress") return <StatusLabel status="running" label="in progress" />;
  if (status === "interrupted") return <StatusLabel status="paused" label="interrupted" />;
  return <StatusLabel status={status} />;
}

function OmissionNotes({ items, label }: { items: OmittedContent[]; label: string }) {
  if (items.length === 0) return null;
  return (
    <ul className="task-omission-list" aria-label={label}>
      {items.map((item, index) => (
        <li key={`${item.reason}-${index}`}>
          {item.label}
          {item.count ? ` / ${item.count}` : ""}
        </li>
      ))}
    </ul>
  );
}

function updateDisclosureSet(
  current: ReadonlySet<string>,
  key: string,
  open: boolean,
): Set<string> {
  const next = new Set(current);
  if (open) next.add(key);
  else next.delete(key);
  return next;
}

function paginationCopy(
  state: PageState,
  count: number,
  hasMore: boolean,
  failure: string | null,
): string {
  if (state === "loading") return `Loading older tasks. ${count} tasks remain visible.`;
  if (state === "refresh")
    return "The task index changed or its cursor expired. Refresh this page before loading more.";
  if (state === "error")
    return `${failure ?? "More tasks could not be loaded."} ${count} tasks remain visible.`;
  if (state === "limit")
    return `${count} tasks loaded. Cockpit's bounded task-index limit has been reached.`;
  return hasMore
    ? `${count} tasks loaded from the state-database index. Load older tasks as needed.`
    : `All ${count} indexed tasks in this result are loaded.`;
}

export function CodexTaskBrowser({ initialPage }: { initialPage: CodexTaskPage }) {
  const [tasks, setTasks] = useState(initialPage.items);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [pageState, setPageState] = useState<PageState>("idle");
  const [pageFailure, setPageFailure] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CodexTaskDetail | null>(null);
  const [detailState, setDetailState] = useState<DetailState>("idle");
  const [detailFailure, setDetailFailure] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openProcess, setOpenProcess] = useState<Set<string>>(() => new Set());
  const [openNested, setOpenNested] = useState<Set<string>>(() => new Set());
  const detailRequest = useRef<AbortController | null>(null);
  const pageRequest = useRef<AbortController | null>(null);
  const detailGeneration = useRef(0);
  const paginationStatusRef = useRef<HTMLParagraphElement>(null);
  const detailTitleRef = useRef<HTMLHeadingElement>(null);
  const shouldRevealDetail = useRef(false);

  const selectedSummary = tasks.find((task) => task.id === selectedId) ?? null;
  const displayedSummary = detail?.summary ?? selectedSummary;

  useEffect(
    () => () => {
      detailGeneration.current += 1;
      detailRequest.current?.abort();
      pageRequest.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (!shouldRevealDetail.current) return;
    shouldRevealDetail.current = false;
    detailTitleRef.current?.focus({ preventScroll: true });
    detailTitleRef.current?.scrollIntoView?.({ block: "start" });
  }, [selectedId]);

  const searchableText = useMemo(() => {
    if (!detail) return "";
    const text: string[] = [];
    for (const turn of detail.turns) {
      text.push(...turn.messages.map((message) => message.content));
      const visibleProcess = visibleProcessSearchText(
        turn.process,
        turn.key,
        openProcess,
        openNested,
      );
      if (visibleProcess) text.push(visibleProcess);
    }
    return text.join("\n");
  }, [detail, openNested, openProcess]);
  const matches = useMemo(() => countMatches(searchableText, query), [query, searchableText]);

  async function loadTask(task: CodexTaskSummary): Promise<void> {
    if (pageState === "loading") return;
    detailRequest.current?.abort();
    const controller = new AbortController();
    const generation = detailGeneration.current + 1;
    detailGeneration.current = generation;
    detailRequest.current = controller;
    const revealDetail =
      typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches;
    shouldRevealDetail.current = revealDetail && task.id !== selectedId;
    if (revealDetail && task.id === selectedId) {
      detailTitleRef.current?.focus({ preventScroll: true });
      detailTitleRef.current?.scrollIntoView?.({ block: "start" });
    }

    setSelectedId(task.id);
    setDetail(null);
    setDetailState("loading");
    setDetailFailure(null);
    setQuery("");
    setOpenProcess(new Set());
    setOpenNested(new Set());

    let safeFailure = "The selected task could not be safely loaded.";
    try {
      const response = await fetch(
        scopedApiPath(PANEL_ID, `/conversations/${encodeURIComponent(task.id)}`),
        { cache: "no-store", signal: controller.signal },
      );
      const payload: unknown = await response.json();
      const parsed = parseScopedPayload(payload, PANEL_ID, codexTaskDetailSchema);
      if (!response.ok || !parsed || parsed.summary.id !== task.id) {
        const failure = parseScopedFailure(payload, PANEL_ID);
        safeFailure = failure?.message ?? safeFailure;
        throw new Error("safe task response rejected");
      }
      if (
        controller.signal.aborted ||
        generation !== detailGeneration.current ||
        !isCurrentPanelLocation(PANEL_ID)
      )
        return;
      setDetail(parsed);
      setDetailState("idle");
    } catch {
      if (
        controller.signal.aborted ||
        generation !== detailGeneration.current ||
        !isCurrentPanelLocation(PANEL_ID)
      )
        return;
      setDetailFailure(safeFailure);
      setDetailState("error");
    }
  }

  async function loadMore(): Promise<void> {
    if (!nextCursor || pageState === "loading" || detailState === "loading") return;
    const requestedCursor = nextCursor;
    pageRequest.current?.abort();
    const controller = new AbortController();
    pageRequest.current = controller;
    setPageState("loading");
    setPageFailure(null);
    try {
      const response = await fetch(
        scopedApiPath(PANEL_ID, `/conversations?cursor=${encodeURIComponent(requestedCursor)}`),
        { cache: "no-store", signal: controller.signal },
      );
      const payload: unknown = await response.json();
      const parsed = parseScopedPayload(payload, PANEL_ID, codexTaskPageSchema);
      if (!response.ok || !parsed) {
        const failure = parseScopedFailure(payload, PANEL_ID);
        setPageFailure(failure?.message ?? "More tasks could not be safely loaded.");
        const needsRefresh =
          failure?.code === "invalid_path" || failure?.code === "protocol_violation";
        if (needsRefresh) setNextCursor(null);
        setPageState(needsRefresh ? "refresh" : "error");
        return;
      }
      if (controller.signal.aborted || !isCurrentPanelLocation(PANEL_ID)) return;

      const known = new Set(tasks.map((task) => task.id));
      const hasDuplicate = parsed.items.some((task) => known.has(task.id));
      const invalidContinuation =
        (parsed.items.length === 0 && parsed.nextCursor !== null) ||
        parsed.nextCursor === requestedCursor;
      if (hasDuplicate || invalidContinuation) {
        setNextCursor(null);
        setPageState("refresh");
        return;
      }

      const remaining = MAX_LOADED_TASKS - tasks.length;
      const additions = parsed.items.slice(0, Math.max(0, remaining));
      const nextTasks = [...tasks, ...additions];
      setTasks(nextTasks);
      if (nextTasks.length >= MAX_LOADED_TASKS) {
        setNextCursor(null);
        setPageState("limit");
      } else {
        setNextCursor(parsed.nextCursor);
        setPageState("idle");
      }
      if (parsed.nextCursor === null || nextTasks.length >= MAX_LOADED_TASKS) {
        queueMicrotask(() => paginationStatusRef.current?.focus());
      }
    } catch {
      if (!controller.signal.aborted && isCurrentPanelLocation(PANEL_ID)) {
        setPageFailure("More tasks could not be safely loaded.");
        setPageState("error");
      }
    }
  }

  const ledger = displayedSummary
    ? [
        { label: "Project", value: `PROJECT / ${projectLabel(displayedSummary)}`, mono: true },
        { label: "Source", value: displayedSummary.source },
        { label: "Status", value: displayedSummary.status },
        {
          label: "Last activity",
          value: displayedSummary.lastActivity
            ? formatShanghaiTime(displayedSummary.lastActivity)
            : "Unknown",
          mono: true,
        },
        {
          label: "Observed",
          value: formatShanghaiTime(detail?.observedAt ?? initialPage.observedAt),
          mono: true,
        },
        { label: "Index", value: initialPage.indexScope },
      ]
    : [
        { label: "Index", value: initialPage.indexScope },
        { label: "Inventory", value: initialPage.inventoryNote },
        { label: "Observed", value: formatShanghaiTime(initialPage.observedAt), mono: true },
        { label: "Page size", value: "5 tasks maximum" },
      ];

  return (
    <div className="inspection-grid codex-task-grid">
      <section
        className="index-pane conversation-index-pane task-index-pane"
        aria-label="Codex task index"
        aria-busy={pageState === "loading"}
      >
        <div className="pane-label">
          TASK INDEX / {tasks.length.toString().padStart(2, "0")}
          {nextCursor ? "+" : ""}
        </div>
        <div className="conversation-list-scroll">
          {tasks.length > 0 ? (
            <ul className="index-list conversation-list task-list">
              {tasks.map((task) => (
                <li key={task.id}>
                  <button
                    type="button"
                    className={cn(
                      "index-row conversation-row task-row",
                      task.id === selectedId && "is-selected",
                    )}
                    onClick={() => void loadTask(task)}
                    aria-pressed={task.id === selectedId}
                    disabled={pageState === "loading"}
                  >
                    <ListTodo aria-hidden="true" size={16} />
                    <span>
                      <strong>{taskTitle(task)}</strong>
                      <span className="task-project">
                        <span>PROJECT / </span>
                        <b>{projectLabel(task)}</b>
                      </span>
                      {task.preview ? <small>{task.preview}</small> : null}
                      <em>
                        {task.lastActivity ? formatShanghaiTime(task.lastActivity) : "Unknown"} ·{" "}
                        {task.source}
                      </em>
                    </span>
                    <TaskStatus status={task.status} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="task-index-state">
              <SourceState
                kind="empty"
                detail="The Codex state-database index contains no eligible interactive tasks."
              />
            </div>
          )}
        </div>
        <footer className="conversation-list-footer">
          {nextCursor ? (
            <Button
              className="show-more"
              disabled={pageState === "loading" || detailState === "loading"}
              aria-busy={pageState === "loading"}
              onClick={() => void loadMore()}
            >
              {pageState === "loading" ? "Loading…" : "Show more"}
            </Button>
          ) : null}
          <p
            className="conversation-pagination-note"
            ref={paginationStatusRef}
            role="status"
            aria-live="polite"
            tabIndex={-1}
          >
            {paginationCopy(pageState, tasks.length, Boolean(nextCursor), pageFailure)}
          </p>
          <p className="task-inventory-note">{initialPage.inventoryNote}</p>
        </footer>
      </section>

      <article
        className="preview-pane transcript-pane codex-task-detail"
        aria-label={selectedSummary ? undefined : "Task detail"}
        aria-labelledby={selectedSummary ? "codex-task-title" : undefined}
        aria-busy={detailState === "loading"}
      >
        {selectedSummary ? (
          <>
            <div className="preview-toolbar task-detail-toolbar">
              <div>
                <p className="eyebrow">TASK TRANSCRIPT</p>
                <h2 id="codex-task-title" ref={detailTitleRef} tabIndex={-1}>
                  {taskTitle(displayedSummary ?? selectedSummary)}
                </h2>
                <p className="task-detail-project">
                  PROJECT / {projectLabel(displayedSummary ?? selectedSummary)}
                </p>
              </div>
              <Button
                size="small"
                className="task-refresh"
                disabled={detailState === "loading" || pageState === "loading"}
                onClick={() => void loadTask(selectedSummary)}
              >
                <RefreshCw aria-hidden="true" size={13} />
                Refresh task
              </Button>
            </div>
            {detailState === "loading" ? (
              <SourceState kind="loading" detail="Reading the selected task without resuming it." />
            ) : null}
            {detailState === "error" ? (
              <SourceState
                kind="error"
                detail={detailFailure ?? "The selected task could not be safely loaded."}
              />
            ) : null}
            {detailState === "idle" && detail ? (
              <>
                <SearchField
                  label="Search loaded task"
                  value={query}
                  onChange={setQuery}
                  resultCount={matches}
                />
                {detail.turns.length > 0 ? (
                  <ol className="task-turn-list">
                    {detail.turns.map((turn, turnIndex) => (
                      <li className="task-turn" key={turn.key}>
                        <header className="task-turn-heading">
                          <span>TURN / {(turnIndex + 1).toString().padStart(2, "0")}</span>
                          <TurnStatus status={turn.status} />
                        </header>
                        {turn.messages.length > 0 ? (
                          <ol className="transcript-list task-message-list">
                            {turn.messages.map((message) => (
                              <li
                                key={message.key}
                                className={cn("message", `message-${message.role}`)}
                              >
                                <header>
                                  <span>{message.role}</span>
                                </header>
                                <p>
                                  <HighlightedText text={message.content} query={query} />
                                </p>
                              </li>
                            ))}
                          </ol>
                        ) : null}
                        {turn.process ? (
                          <CodexProcessTimeline
                            onNestedToggle={(key, open) =>
                              setOpenNested((current) => updateDisclosureSet(current, key, open))
                            }
                            onProcessToggle={(key, open) =>
                              setOpenProcess((current) => updateDisclosureSet(current, key, open))
                            }
                            query={query}
                            timeline={turn.process}
                            turnKey={turn.key}
                          />
                        ) : null}
                        <OmissionNotes
                          items={turn.omitted}
                          label={`Omitted content for turn ${turnIndex + 1}`}
                        />
                      </li>
                    ))}
                  </ol>
                ) : (
                  <SourceState kind="empty" detail="This task contains no safe transcript turns." />
                )}
                {detail.historyNote ? (
                  <p className="text-sm text-muted-foreground">{detail.historyNote}</p>
                ) : null}
                <OmissionNotes items={detail.omitted} label="Omitted task content" />
              </>
            ) : null}
          </>
        ) : (
          <div className="task-detail-placeholder">
            <SourceState
              kind="empty"
              title="Select a task"
              detail="Choose one indexed task to read its bounded transcript and optional Process evidence."
            />
          </div>
        )}
      </article>

      <SourceLedger title="Task metadata" items={ledger} />
    </div>
  );
}
