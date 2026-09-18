"use client";

import { FileKey2, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { countMatches } from "@/components/highlighted-text";
import { SafeMarkdown } from "@/components/safe-markdown";
import { SearchField } from "@/components/search-field";
import { SourceLedger } from "@/components/source-ledger";
import { SourceState } from "@/components/source-state";
import { StatusLabel } from "@/components/status-label";
import type { AgentPanelId } from "@/contracts/agents";
import type { SystemSource } from "@/contracts/cockpit";
import { systemSourceSchema } from "@/contracts/source-result";
import { cn } from "@/lib/cn";
import { isCurrentPanelLocation, parseScopedPayload, scopedApiPath } from "@/lib/scoped-client";
import { formatShanghaiTime } from "@/lib/time";

const SYSTEM_TIMESTAMP_LABELS = new Set(["Modified", "Session time"]);

function displayMetadata(items: SystemSource["metadata"]): SystemSource["metadata"] {
  return items.map((item) =>
    SYSTEM_TIMESTAMP_LABELS.has(item.label) && !item.value.endsWith(" CST")
      ? { ...item, value: formatShanghaiTime(item.value) }
      : item,
  );
}

function matchesCollectionQuery(
  item: NonNullable<SystemSource["collection"]>["items"][number],
  query: string,
): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return [item.name, item.description, item.category, item.status, item.path ?? ""].some((value) =>
    value.toLocaleLowerCase().includes(normalized),
  );
}

export function SystemBrowser({
  panelId,
  sources,
}: {
  panelId?: AgentPanelId | undefined;
  sources: SystemSource[];
}) {
  const first = sources[0];
  const [selectedId, setSelectedId] = useState(first?.id ?? "");
  const [query, setQuery] = useState("");
  const [collectionQuery, setCollectionQuery] = useState("");
  const [previewQuery, setPreviewQuery] = useState("");
  const [selectedCollectionItemId, setSelectedCollectionItemId] = useState("");
  const [skillPreview, setSkillPreview] = useState<SystemSource | null>(null);
  const [skillPreviewState, setSkillPreviewState] = useState<"idle" | "loading" | "error">("idle");
  const previewRequest = useRef<AbortController | null>(null);
  const previewTitleRef = useRef<HTMLHeadingElement>(null);
  const shouldRevealPreview = useRef(false);
  const selected = sources.find((source) => source.id === selectedId) ?? first;
  const matches = useMemo(
    () => (selected ? countMatches(selected.content, query) : 0),
    [query, selected],
  );
  const collectionItems = useMemo(
    () =>
      selected?.collection?.items.filter((item) => matchesCollectionQuery(item, collectionQuery)) ??
      [],
    [collectionQuery, selected],
  );
  const selectedCollectionItem = selected?.collection?.items.find(
    (item) => item.id === selectedCollectionItemId,
  );
  const skillMatches = useMemo(
    () => (skillPreview ? countMatches(skillPreview.content, previewQuery) : 0),
    [previewQuery, skillPreview],
  );

  useEffect(() => () => previewRequest.current?.abort(), []);

  useEffect(() => {
    if (!shouldRevealPreview.current) return;
    shouldRevealPreview.current = false;
    previewTitleRef.current?.focus({ preventScroll: true });
    previewTitleRef.current?.scrollIntoView?.({ block: "start" });
  }, [selectedId]);

  const selectSource = (id: string) => {
    previewRequest.current?.abort();
    const revealPreview =
      typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches;
    shouldRevealPreview.current = revealPreview && id !== selectedId;
    if (revealPreview && id === selectedId) {
      previewTitleRef.current?.focus({ preventScroll: true });
      previewTitleRef.current?.scrollIntoView?.({ block: "start" });
    }
    setSelectedId(id);
    setQuery("");
    setCollectionQuery("");
    setPreviewQuery("");
    setSelectedCollectionItemId("");
    setSkillPreview(null);
    setSkillPreviewState("idle");
  };

  const loadSkill = async (id: string) => {
    previewRequest.current?.abort();
    const controller = new AbortController();
    previewRequest.current = controller;
    setSkillPreview(null);
    setSkillPreviewState("loading");
    try {
      const endpoint = panelId
        ? scopedApiPath(panelId, `/system/context?id=${encodeURIComponent(id)}`)
        : `/api/system/context?id=${encodeURIComponent(id)}`;
      const response = await fetch(endpoint, {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      const parsed = panelId
        ? parseScopedPayload(payload, panelId, systemSourceSchema)
        : systemSourceSchema.safeParse(payload).data;
      if (!response.ok || !parsed || parsed.collection) throw new Error("invalid skill preview");
      if (!controller.signal.aborted && (!panelId || isCurrentPanelLocation(panelId))) {
        setSkillPreview(parsed);
        setSkillPreviewState("idle");
      }
    } catch {
      if (!controller.signal.aborted && (!panelId || isCurrentPanelLocation(panelId))) {
        setSkillPreviewState("error");
      }
    }
  };

  const selectCollectionItem = (id: string) => {
    setSelectedCollectionItemId(id);
    setPreviewQuery("");
    if (selected?.collection?.kind === "skills") {
      setCollectionQuery("");
      void loadSkill(id);
    }
  };

  if (!selected) return <p className="state-message">System sources are unavailable.</p>;

  return (
    <div className="inspection-grid">
      <section className="index-pane" aria-label="System sources">
        <div className="pane-label">
          CONTEXT INDEX / {sources.length.toString().padStart(2, "0")}
        </div>
        <ul className="index-list">
          {sources.map((source, index) => (
            <li key={source.id}>
              <button
                type="button"
                className={cn("index-row", source.id === selected.id && "is-selected")}
                onClick={() => selectSource(source.id)}
                aria-pressed={source.id === selected.id}
              >
                <span className="row-index">{String(index + 1).padStart(2, "0")}</span>
                <span>
                  <strong>{source.title}</strong>
                  <small>{source.category}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <article className="preview-pane" aria-labelledby="system-preview-title">
        <div className="preview-toolbar">
          <div>
            {!selected.collection ? <p className="eyebrow">{selected.category}</p> : null}
            <h2 id="system-preview-title" ref={previewTitleRef} tabIndex={-1}>
              {selected.title}
            </h2>
          </div>
          <StatusLabel status={selected.stamp.state} />
        </div>
        {!selected.collection ? <p className="preview-summary">{selected.summary}</p> : null}
        {selected.stamp.state === "ready" && selected.collection ? (
          <>
            <SearchField
              label={`Filter ${selected.collection.kind}`}
              value={collectionQuery}
              onChange={setCollectionQuery}
              resultCount={collectionItems.length}
            />
            <ul className="capability-list" aria-label={`${selected.title} list`}>
              {collectionItems.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={cn(
                      "capability-row",
                      selectedCollectionItemId === item.id && "is-selected",
                    )}
                    onClick={() => selectCollectionItem(item.id)}
                    aria-pressed={selectedCollectionItemId === item.id}
                  >
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.description}</small>
                    </span>
                    <span className="capability-meta">
                      <em>{item.category}</em>
                      <b>{item.status}</b>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {collectionItems.length === 0 ? (
              <p className="state-message">No matching entries.</p>
            ) : null}
            {skillPreviewState === "loading" ? (
              <SourceState kind="loading" detail="Loading the selected bounded skill manifest." />
            ) : null}
            {skillPreviewState === "error" ? (
              <SourceState
                kind="error"
                detail="The selected skill manifest could not be safely loaded."
              />
            ) : null}
            {skillPreview ? (
              <section className="capability-preview" aria-labelledby="skill-preview-title">
                <h3 className="sr-only" id="skill-preview-title">
                  {skillPreview.title} instructions
                </h3>
                <SearchField
                  label="Search selected skill"
                  value={previewQuery}
                  onChange={setPreviewQuery}
                  resultCount={skillMatches}
                />
                <SafeMarkdown
                  ariaLabel={`${skillPreview.title} preview`}
                  content={skillPreview.content}
                  query={previewQuery}
                />
                {skillPreview.stamp.truncated ? (
                  <p className="truncation-note">Preview is bounded.</p>
                ) : null}
              </section>
            ) : null}
            {selected.collection.kind === "tools" && selectedCollectionItem ? (
              <section
                className="capability-preview tool-preview"
                aria-labelledby="tool-preview-title"
              >
                <p className="eyebrow">
                  {selectedCollectionItem.category} / {selectedCollectionItem.status}
                </p>
                <h3 id="tool-preview-title">{selectedCollectionItem.name}</h3>
                <p>{selectedCollectionItem.description}</p>
              </section>
            ) : null}
          </>
        ) : selected.stamp.state === "ready" ? (
          <>
            <SearchField
              label="Search this document"
              value={query}
              onChange={setQuery}
              resultCount={matches}
            />
            <SafeMarkdown
              ariaLabel={`${selected.title} preview`}
              content={selected.content}
              query={query}
            />
          </>
        ) : (
          <SourceState
            kind={selected.stamp.state === "unavailable" ? "unavailable" : "error"}
            detail={selected.content}
          />
        )}
        {selected.stamp.truncated ? (
          <p className="truncation-note">
            Preview is bounded. Additional source content is not shown.
          </p>
        ) : null}
      </article>

      <div className="ledger-column">
        <SourceLedger title="Provenance" items={displayMetadata(selected.metadata)} />
        <section className="boundary-note">
          <ShieldCheck aria-hidden="true" size={17} />
          <div>
            <strong>Allowlisted preview</strong>
            <p>Credentials and raw provider settings are never sent to the browser.</p>
          </div>
        </section>
        <section className="source-path">
          <FileKey2 aria-hidden="true" size={16} />
          <span>{selected.stamp.path}</span>
        </section>
      </div>
    </div>
  );
}
