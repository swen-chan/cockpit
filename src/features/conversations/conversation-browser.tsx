"use client";

import { MessageSquareText, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { countMatches, HighlightedText } from "@/components/highlighted-text";
import { SearchField } from "@/components/search-field";
import { SourceLedger } from "@/components/source-ledger";
import { SourceState } from "@/components/source-state";
import { Button } from "@/components/ui/button";
import type { Conversation, ConversationPage, ConversationSummary } from "@/contracts/cockpit";
import { conversationPageSchema, conversationSchema } from "@/contracts/source-result";
import { cn } from "@/lib/cn";
import { formatShanghaiTime } from "@/lib/time";

const PAGE_SIZE = 5;

export function ConversationBrowser({
  initialConversation,
  initialFailure,
  initialPage,
}: {
  initialConversation: Conversation | null;
  initialFailure?: string | undefined;
  initialPage: ConversationPage;
}) {
  const [conversations, setConversations] = useState<ConversationSummary[]>(initialPage.items);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [selectedId, setSelectedId] = useState(initialConversation?.id ?? initialPage.items[0]?.id ?? "");
  const [selectedConversation, setSelectedConversation] = useState(initialConversation);
  const [transcriptState, setTranscriptState] = useState<"idle" | "loading" | "error">(
    initialFailure ? "error" : "idle",
  );
  const [pageState, setPageState] = useState<"idle" | "loading" | "error">("idle");
  const [query, setQuery] = useState("");
  const transcriptRequest = useRef<AbortController | null>(null);
  const paginationStatusRef = useRef<HTMLParagraphElement>(null);
  const transcriptTitleRef = useRef<HTMLHeadingElement>(null);
  const shouldFocusPaginationStatus = useRef(false);
  const shouldRevealTranscript = useRef(false);
  const selectedSummary = conversations.find((item) => item.id === selectedId) ?? conversations[0];
  const searchableText = selectedConversation?.messages.map((message) => message.content).join("\n") ?? "";
  const matches = useMemo(() => countMatches(searchableText, query), [query, searchableText]);

  useEffect(() => {
    if (!shouldRevealTranscript.current) return;
    shouldRevealTranscript.current = false;
    transcriptTitleRef.current?.focus({ preventScroll: true });
    transcriptTitleRef.current?.scrollIntoView?.({ block: "start" });
  }, [selectedId]);

  useEffect(() => {
    if (!shouldFocusPaginationStatus.current) return;
    shouldFocusPaginationStatus.current = false;
    paginationStatusRef.current?.focus();
  }, [nextCursor]);

  const loadTranscript = async (conversation: ConversationSummary) => {
    transcriptRequest.current?.abort();
    const controller = new AbortController();
    transcriptRequest.current = controller;
    const revealTranscript = typeof window.matchMedia === "function"
      && window.matchMedia("(max-width: 767px)").matches;
    shouldRevealTranscript.current = revealTranscript && conversation.id !== selectedId;
    if (revealTranscript && conversation.id === selectedId) {
      transcriptTitleRef.current?.focus({ preventScroll: true });
      transcriptTitleRef.current?.scrollIntoView?.({ block: "start" });
    }
    setSelectedId(conversation.id);
    setSelectedConversation(null);
    setTranscriptState("loading");
    setQuery("");
    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(conversation.id)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      const parsed = conversationSchema.safeParse(payload);
      if (!response.ok || !parsed.success) throw new Error("invalid conversation transcript");
      if (!controller.signal.aborted) {
        setSelectedConversation(parsed.data);
        setTranscriptState("idle");
      }
    } catch {
      if (!controller.signal.aborted) setTranscriptState("error");
    }
  };

  const loadMore = async () => {
    if (!nextCursor || pageState === "loading") return;
    setPageState("loading");
    try {
      const response = await fetch(
        `/api/conversations?cursor=${encodeURIComponent(nextCursor)}&limit=${PAGE_SIZE}`,
        { cache: "no-store" },
      );
      const payload: unknown = await response.json();
      const parsed = conversationPageSchema.safeParse(payload);
      if (!response.ok || !parsed.success) throw new Error("invalid conversation page");
      setConversations((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...parsed.data.items.filter((item) => !known.has(item.id))];
      });
      shouldFocusPaginationStatus.current = parsed.data.nextCursor === null;
      setNextCursor(parsed.data.nextCursor);
      setPageState("idle");
    } catch {
      setPageState("error");
    }
  };

  if (!selectedSummary) {
    return (
      <SourceState
        kind={initialFailure ? "error" : "empty"}
        {...(initialFailure ? { detail: initialFailure } : {})}
      />
    );
  }

  const ledger = [
    { label: "Source", value: selectedSummary.source },
    { label: "Last activity", value: formatShanghaiTime(selectedSummary.lastActivity), mono: true },
    { label: "Model", value: selectedSummary.model, mono: true },
    { label: "Profile", value: selectedSummary.profile, mono: true },
    { label: "Workspace", value: selectedSummary.workspace, mono: true },
    { label: "Messages", value: String(selectedSummary.messageCount), mono: true },
    { label: "Tool calls", value: String(selectedSummary.toolCallCount), mono: true },
    { label: "Eligibility", value: "Interactive / visible" },
  ];

  return (
    <div className="inspection-grid conversation-grid">
      <section
        className="index-pane conversation-index-pane"
        aria-label="Eligible conversations"
        aria-busy={pageState === "loading"}
      >
        <div className="pane-label">
          ELIGIBLE SESSIONS / {conversations.length.toString().padStart(2, "0")}{nextCursor ? "+" : ""}
        </div>
        <div className="conversation-list-scroll">
          <ul className="index-list conversation-list">
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <button
                  type="button"
                  className={cn("index-row conversation-row", conversation.id === selectedSummary.id && "is-selected")}
                  onClick={() => void loadTranscript(conversation)}
                  aria-pressed={conversation.id === selectedSummary.id}
                >
                  <MessageSquareText aria-hidden="true" size={16} />
                  <span>
                    <strong>{conversation.title}</strong>
                    <small>{conversation.preview}</small>
                    <em>{formatShanghaiTime(conversation.lastActivity)} · {conversation.source}</em>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <footer className="conversation-list-footer">
          {nextCursor ? (
            <Button
              className="show-more"
              disabled={pageState === "loading"}
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
            {pageState === "error"
              ? `More conversations could not be loaded. ${conversations.length} sessions remain loaded.`
              : nextCursor
              ? `${conversations.length} sessions loaded. Load older eligible sessions as needed.`
              : `All ${conversations.length} eligible sessions are loaded.`}
          </p>
        </footer>
      </section>

      <article
        className="preview-pane transcript-pane"
        aria-labelledby="conversation-title"
        aria-busy={transcriptState === "loading"}
      >
        <div className="preview-toolbar">
          <div>
            <p className="eyebrow">TRANSCRIPT</p>
            <h2 id="conversation-title" ref={transcriptTitleRef} tabIndex={-1}>{selectedSummary.title}</h2>
          </div>
        </div>
        {transcriptState === "loading" ? <SourceState kind="loading" detail="Loading the selected transcript." /> : null}
        {transcriptState === "error" ? (
          <SourceState kind="error" detail={initialFailure ?? "The selected transcript could not be safely loaded."} />
        ) : null}
        {transcriptState === "idle" && selectedConversation ? (
          <>
            <SearchField label="Search loaded transcript" value={query} onChange={setQuery} resultCount={matches} />
            {selectedConversation.messages.length > 0 ? (
              <ol className="transcript-list">
                {selectedConversation.messages.map((message) => (
                  <li key={message.id} className={cn("message", `message-${message.role}`)}>
                    <header>
                      <span>{message.role === "tool" ? <Wrench aria-hidden="true" size={13} /> : null}{message.role}</span>
                      <time>{formatShanghaiTime(message.timestamp)}</time>
                    </header>
                    <p><HighlightedText text={message.content} query={query} /></p>
                  </li>
                ))}
              </ol>
            ) : <SourceState kind="empty" detail="This session contains no visible active messages." />}
            {selectedConversation.truncated ? <p className="truncation-note">Transcript preview is bounded.</p> : null}
          </>
        ) : null}
      </article>
      <SourceLedger title="Conversation metadata" items={ledger} />
    </div>
  );
}
