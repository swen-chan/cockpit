"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { SafeMarkdown } from "@/components/safe-markdown";
import { SearchField } from "@/components/search-field";
import { SourceLedger } from "@/components/source-ledger";
import { SourceState } from "@/components/source-state";
import { StatusLabel } from "@/components/status-label";
import {
  claudeSystemCategorySchema,
  type ClaudeSystemSnapshot,
  type ClaudeSystemSource,
} from "@/contracts/claude-system";
import { cn } from "@/lib/cn";
import { formatShanghaiTime } from "@/lib/time";

const CATEGORY_DESCRIPTION: Record<ClaudeSystemSource["category"], string> = {
  Instructions: "Current instruction files and rules.",
  Memory: "Saved index and topic notes from the configured memory directory.",
  Skills: "Reusable skill instructions.",
  Subagents: "Custom subagent definitions.",
};

export function ClaudeSystemBrowser({ snapshot }: { snapshot: ClaudeSystemSnapshot }) {
  const [selectedKey, setSelectedKey] = useState(snapshot.sources[0]?.key ?? "");
  const [query, setQuery] = useState("");
  const previewTitleRef = useRef<HTMLHeadingElement>(null);
  const shouldRevealPreview = useRef(false);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleSources = snapshot.sources.filter((source) =>
    [source.relativePath, source.scope, source.category, source.content ?? ""].some((value) =>
      value.toLocaleLowerCase().includes(normalizedQuery),
    ),
  );
  const selected = visibleSources.find((source) => source.key === selectedKey) ?? visibleSources[0];

  useEffect(() => {
    if (!shouldRevealPreview.current) return;
    shouldRevealPreview.current = false;
    previewTitleRef.current?.focus({ preventScroll: true });
    previewTitleRef.current?.scrollIntoView?.({ block: "start" });
  }, [selectedKey]);

  function selectSource(key: string) {
    const revealPreview =
      typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches;
    shouldRevealPreview.current = revealPreview && selectedKey !== key;
    if (revealPreview && selectedKey === key) {
      previewTitleRef.current?.focus({ preventScroll: true });
      previewTitleRef.current?.scrollIntoView?.({ block: "start" });
    }
    setSelectedKey(key);
  }

  return (
    <div className="inspection-grid claude-session-grid claude-system-grid">
      <section className="index-pane" aria-label="Claude System sources">
        <div className="pane-label">SYSTEM INDEX / {snapshot.sources.length}</div>
        <SearchField
          label="Search System documents"
          value={query}
          onChange={setQuery}
          resultCount={visibleSources.length}
        />
        {claudeSystemCategorySchema.options.map((category) => {
          const sources = visibleSources.filter((source) => source.category === category);
          return (
            <section key={category} aria-label={`${category} sources`}>
              <h2 className="pane-label">{category}</h2>
              {sources.length ? (
                <ul className="index-list">
                  {sources.map((source) => (
                    <li key={source.key}>
                      <button
                        type="button"
                        className={cn("index-row", selected?.key === source.key && "is-selected")}
                        aria-pressed={selected?.key === source.key}
                        onClick={() => selectSource(source.key)}
                      >
                        <span>
                          <strong>{source.relativePath}</strong>
                          <small>{source.scope}</small>
                        </span>
                        <StatusLabel
                          status={source.state}
                          label={source.state === "ready" ? "Current" : "Unavailable"}
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="state-message">
                  {query ? "No matching documents." : "No sources found."}
                </p>
              )}
            </section>
          );
        })}
        {snapshot.limited ? (
          <p className="truncation-note">
            This index is bounded. Additional sources are not shown.
          </p>
        ) : null}
        {snapshot.unavailableScopes.length ? (
          <p className="state-message" role="status">
            Some sources could not be read: {snapshot.unavailableScopes.join(", ")}.
          </p>
        ) : null}
      </section>

      <article className="preview-pane" aria-labelledby="claude-system-preview-title">
        {selected ? (
          <>
            <div className="preview-toolbar">
              <div>
                <p className="eyebrow">
                  {selected.scope} / {selected.category}
                </p>
                <h2 id="claude-system-preview-title" ref={previewTitleRef} tabIndex={-1}>
                  {selected.relativePath}
                </h2>
              </div>
            </div>
            <p className="preview-summary">{CATEGORY_DESCRIPTION[selected.category]}</p>
            {selected.state === "ready" && selected.content !== null ? (
              selected.content.trim() ? (
                <SafeMarkdown
                  ariaLabel={`${selected.relativePath} preview`}
                  content={selected.content}
                  query={query}
                />
              ) : (
                <SourceState kind="empty" title="Empty document" detail="This file has no text." />
              )
            ) : (
              <SourceState kind="unavailable" detail="This document could not be read safely." />
            )}
            {selected.truncated ? (
              <p className="truncation-note">
                Preview is bounded. Additional document text is not shown.
              </p>
            ) : null}
            <details className="claude-source-disclosure">
              <summary>
                <ChevronDown size={16} aria-hidden="true" />
                Source details
              </summary>
              <SourceLedger
                title="Current source"
                items={[
                  { label: "Scope", value: selected.scope },
                  { label: "Document", value: selected.relativePath, mono: true },
                  { label: "Observed", value: formatShanghaiTime(snapshot.observedAt), mono: true },
                ]}
              />
              <p className="exclusion-note">
                Current discovery does not prove that a historical conversation loaded this
                document. Imports, activation rules, and loading priority are not reconstructed.
                Skills and subagents are shown as definitions, not evidence of execution.
              </p>
            </details>
          </>
        ) : (
          <>
            <h2 id="claude-system-preview-title" ref={previewTitleRef} tabIndex={-1}>
              {query ? "No matching documents" : "No System documents found"}
            </h2>
            <p className="state-message">
              {query
                ? "Try another search in the displayed sources."
                : "No supported documents were found in the configured sources."}
            </p>
          </>
        )}
      </article>
    </div>
  );
}
