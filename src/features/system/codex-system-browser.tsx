"use client";

import { ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { countMatches } from "@/components/highlighted-text";
import { SafeMarkdown } from "@/components/safe-markdown";
import { SearchField } from "@/components/search-field";
import { SourceLedger } from "@/components/source-ledger";
import { SourceState } from "@/components/source-state";
import { StatusLabel } from "@/components/status-label";
import type { CodexSystemSnapshot } from "@/contracts/codex";
import { cn } from "@/lib/cn";
import { formatShanghaiTime } from "@/lib/time";

type GuidanceSource = CodexSystemSnapshot["sources"][number];
type SelectionKey = "runtime" | GuidanceSource["key"];

const SOURCE_SCOPE: Readonly<Record<GuidanceSource["key"], string>> = Object.freeze({
  "global-guidance": "Codex home",
  "workspace-guidance": "Approved workspace",
  "custom-guidance": "Configured workspace file",
});

function guidanceStatus(
  state: GuidanceSource["state"],
): "ready" | "unknown" | "unavailable" | "error" {
  return state === "missing" ? "unknown" : state;
}

function GuidanceFailure({ source }: { source: Exclude<GuidanceSource, { state: "ready" }> }) {
  if (source.state === "missing") {
    return <SourceState kind="empty" title="No guidance observed" detail={source.message} />;
  }
  return <SourceState kind={source.state} detail={source.message} />;
}

export function CodexSystemBrowser({ snapshot }: { snapshot: CodexSystemSnapshot }) {
  const firstSource = snapshot.sources[0];
  const [selectedKey, setSelectedKey] = useState<SelectionKey>(firstSource?.key ?? "runtime");
  const [query, setQuery] = useState("");
  const previewTitleRef = useRef<HTMLHeadingElement>(null);
  const shouldRevealPreview = useRef(false);
  const selectedSource = snapshot.sources.find((source) => source.key === selectedKey) ?? null;
  const selectedReadySource = selectedSource?.state === "ready" ? selectedSource : null;
  const matches = useMemo(
    () => (selectedReadySource ? countMatches(selectedReadySource.content, query) : 0),
    [query, selectedReadySource],
  );

  useEffect(() => {
    if (!shouldRevealPreview.current) return;
    shouldRevealPreview.current = false;
    previewTitleRef.current?.focus({ preventScroll: true });
    previewTitleRef.current?.scrollIntoView?.({ block: "start" });
  }, [selectedKey]);

  const select = (key: SelectionKey) => {
    const revealPreview =
      typeof window.matchMedia === "function" && window.matchMedia("(max-width: 767px)").matches;
    shouldRevealPreview.current = revealPreview && key !== selectedKey;
    if (revealPreview && key === selectedKey) {
      previewTitleRef.current?.focus({ preventScroll: true });
      previewTitleRef.current?.scrollIntoView?.({ block: "start" });
    }
    setSelectedKey(key);
    setQuery("");
  };

  const runtimeState = snapshot.runtime.state;
  const selectedLabel =
    selectedKey === "runtime" ? "Codex CLI" : (selectedSource?.label ?? "Current guidance");
  const selectedState =
    selectedKey === "runtime" ? runtimeState : (selectedSource?.state ?? "unavailable");
  const ledger = [
    { label: "Runtime", value: snapshot.runtime.label },
    { label: "Runtime state", value: runtimeState },
    {
      label: "Version",
      value: snapshot.runtime.state === "ready" ? snapshot.runtime.version : "Unavailable",
      mono: true,
    },
    { label: "Selected view", value: selectedLabel },
    { label: "Selected state", value: selectedState },
    { label: "Observed", value: formatShanghaiTime(snapshot.observedAt), mono: true },
  ];

  return (
    <>
      <div className="inspection-grid">
        <section className="index-pane" aria-label="Codex runtime and current guidance">
          <div className="pane-label">
            SYSTEM INDEX / {(snapshot.sources.length + 1).toString().padStart(2, "0")}
          </div>
          <ul className="index-list">
            <li>
              <button
                type="button"
                className={cn("index-row", selectedKey === "runtime" && "is-selected")}
                onClick={() => select("runtime")}
                aria-pressed={selectedKey === "runtime"}
              >
                <span className="row-index">01</span>
                <span>
                  <strong>{snapshot.runtime.label}</strong>
                  <small>Runtime</small>
                </span>
                <StatusLabel status={runtimeState} />
              </button>
            </li>
            {snapshot.sources.map((source, index) => (
              <li key={source.key}>
                <button
                  type="button"
                  className={cn("index-row", selectedKey === source.key && "is-selected")}
                  onClick={() => select(source.key)}
                  aria-pressed={selectedKey === source.key}
                >
                  <span className="row-index">{String(index + 2).padStart(2, "0")}</span>
                  <span>
                    <strong>{source.label}</strong>
                    <small>{SOURCE_SCOPE[source.key]}</small>
                  </span>
                  <StatusLabel status={guidanceStatus(source.state)} label={source.state} />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <article className="preview-pane" aria-labelledby="codex-system-preview-title">
          {selectedKey === "runtime" ? (
            <>
              <div className="preview-toolbar">
                <div>
                  <p className="eyebrow">RUNTIME</p>
                  <h2 id="codex-system-preview-title" ref={previewTitleRef} tabIndex={-1}>
                    {snapshot.runtime.label}
                  </h2>
                </div>
                <StatusLabel status={runtimeState} />
              </div>
              {snapshot.runtime.state === "ready" ? (
                <p className="preview-summary">
                  Compatible read-only runtime {snapshot.runtime.version}.
                </p>
              ) : (
                <SourceState kind={snapshot.runtime.state} detail={snapshot.runtime.message} />
              )}
            </>
          ) : selectedSource ? (
            <>
              <div className="preview-toolbar">
                <div>
                  <p className="eyebrow">{SOURCE_SCOPE[selectedSource.key]}</p>
                  <h2 id="codex-system-preview-title" ref={previewTitleRef} tabIndex={-1}>
                    {selectedSource.label}
                  </h2>
                </div>
                <StatusLabel
                  status={guidanceStatus(selectedSource.state)}
                  label={selectedSource.state}
                />
              </div>
              <p className="preview-summary">
                Current observable guidance from an approved local source.
              </p>
              {selectedSource.state === "ready" ? (
                <>
                  <SearchField
                    label="Search current guidance"
                    value={query}
                    onChange={setQuery}
                    resultCount={matches}
                  />
                  <SafeMarkdown
                    ariaLabel={`${selectedSource.label} preview`}
                    content={selectedSource.content}
                    query={query}
                  />
                  {selectedSource.truncated ? (
                    <p className="truncation-note">
                      Preview is bounded. Additional guidance content is not shown.
                    </p>
                  ) : null}
                </>
              ) : (
                <GuidanceFailure source={selectedSource} />
              )}
            </>
          ) : (
            <SourceState kind="unavailable" detail="Current guidance is unavailable." />
          )}
        </article>

        <div className="ledger-column">
          <SourceLedger title="Current guidance" items={ledger} />
          <section className="boundary-note">
            <ShieldCheck aria-hidden="true" size={17} />
            <div>
              <strong>Current, not historical</strong>
              <p>
                This view reports guidance observable now. It cannot prove the exact context used by
                a historical task.
              </p>
            </div>
          </section>
          <p className="exclusion-note">
            Codex can discover guidance along a root-to-working-directory chain. Cockpit checks only
            the configured Codex home and approved workspace root; it does not rebuild that full
            chain. An explicitly configured extra file appears only as Custom guidance and is not
            treated as a Codex standard.
          </p>
        </div>
      </div>
    </>
  );
}
