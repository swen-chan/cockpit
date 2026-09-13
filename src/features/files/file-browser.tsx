"use client";

import { ArrowLeft, File, FileText, Folder, FolderRoot, LockKeyhole } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { countMatches, HighlightedText } from "@/components/highlighted-text";
import { SafeMarkdown } from "@/components/safe-markdown";
import { SearchField } from "@/components/search-field";
import { SourceLedger } from "@/components/source-ledger";
import { SourceState } from "@/components/source-state";
import { Button } from "@/components/ui/button";
import type { WorkspaceDirectory, WorkspaceFile } from "@/contracts/cockpit";
import { workspaceDirectorySchema, workspaceFileSchema } from "@/contracts/source-result";
import { cn } from "@/lib/cn";
import { formatShanghaiTime } from "@/lib/time";

type LoadState = "idle" | "loading" | "error";

export function FileBrowser({
  initialDirectory,
  initialDirectoryFailure,
  initialFile,
  initialPreviewFailure,
}: {
  initialDirectory: WorkspaceDirectory;
  initialDirectoryFailure?: string | undefined;
  initialFile: WorkspaceFile | null;
  initialPreviewFailure?: string | undefined;
}) {
  const [directory, setDirectory] = useState(initialDirectory);
  const [selectedFile, setSelectedFile] = useState(initialFile);
  const [directoryState, setDirectoryState] = useState<LoadState>(initialDirectoryFailure ? "error" : "idle");
  const [previewState, setPreviewState] = useState<LoadState>(initialPreviewFailure ? "error" : "idle");
  const [directoryFailure, setDirectoryFailure] = useState(initialDirectoryFailure);
  const [previewFailure, setPreviewFailure] = useState(initialPreviewFailure);
  const [hasUsableDirectory, setHasUsableDirectory] = useState(!initialDirectoryFailure);
  const [query, setQuery] = useState("");
  const directoryRequest = useRef<AbortController | null>(null);
  const previewRequest = useRef<AbortController | null>(null);
  const directoryRootRef = useRef<HTMLDivElement>(null);
  const previewTitleRef = useRef<HTMLHeadingElement>(null);
  const shouldFocusDirectoryRoot = useRef(false);
  const shouldRevealPreview = useRef(false);
  const matches = useMemo(
    () => countMatches(selectedFile?.content ?? "", query),
    [query, selectedFile?.content],
  );

  useEffect(() => {
    if (!shouldRevealPreview.current) return;
    shouldRevealPreview.current = false;
    previewTitleRef.current?.focus({ preventScroll: true });
    previewTitleRef.current?.scrollIntoView?.({ block: "start" });
  }, [selectedFile?.path]);

  useEffect(() => {
    if (!shouldFocusDirectoryRoot.current) return;
    shouldFocusDirectoryRoot.current = false;
    directoryRootRef.current?.focus();
  }, [directory.path]);

  const openDirectory = async (relativePath: string) => {
    directoryRequest.current?.abort();
    previewRequest.current?.abort();
    const controller = new AbortController();
    directoryRequest.current = controller;
    shouldRevealPreview.current = false;
    setDirectoryState("loading");
    setPreviewState("idle");
    setDirectoryFailure(undefined);
    setPreviewFailure(undefined);
    setQuery("");
    try {
      const response = await fetch(`/api/files?path=${encodeURIComponent(relativePath)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      const parsed = workspaceDirectorySchema.safeParse(payload);
      if (!response.ok || !parsed.success) throw new Error("invalid workspace directory");
      if (!controller.signal.aborted) {
        shouldFocusDirectoryRoot.current = true;
        setDirectory(parsed.data);
        setHasUsableDirectory(true);
        setSelectedFile(null);
        setDirectoryState("idle");
      }
    } catch {
      if (!controller.signal.aborted) {
        setDirectoryFailure("The selected directory could not be safely loaded.");
        setDirectoryState("error");
      }
    }
  };

  const openFile = async (entry: WorkspaceFile) => {
    directoryRequest.current?.abort();
    previewRequest.current?.abort();
    setDirectoryState("idle");
    setDirectoryFailure(undefined);
    const revealPreview = typeof window.matchMedia === "function"
      && window.matchMedia("(max-width: 767px)").matches;
    shouldRevealPreview.current = revealPreview && entry.path !== selectedFile?.path;
    if (revealPreview && entry.path === selectedFile?.path) {
      previewTitleRef.current?.focus({ preventScroll: true });
      previewTitleRef.current?.scrollIntoView?.({ block: "start" });
    }
    setSelectedFile(entry);
    setPreviewFailure(undefined);
    setQuery("");
    const controller = new AbortController();
    previewRequest.current = controller;
    setPreviewState("loading");
    try {
      const response = await fetch(`/api/files/preview?path=${encodeURIComponent(entry.path)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      const parsed = workspaceFileSchema.safeParse(payload);
      if (!response.ok || !parsed.success) throw new Error("invalid workspace preview");
      if (!controller.signal.aborted) {
        setSelectedFile(parsed.data);
        setPreviewState("idle");
      }
    } catch {
      if (!controller.signal.aborted) {
        setPreviewFailure("The selected file could not be safely previewed.");
        setPreviewState("error");
      }
    }
  };

  const currentLedger = selectedFile ? [
    { label: "Relative path", value: selectedFile.path, mono: true },
    { label: "Detected type", value: selectedFile.kind },
    { label: "Size", value: selectedFile.size, mono: true },
    { label: "Modified", value: formatShanghaiTime(selectedFile.modifiedAt), mono: true },
    { label: "Preview", value: previewState === "error" ? "Load failed" : selectedFile.previewState },
  ] : [
    { label: "Relative path", value: directory.path || "/", mono: true },
    { label: "Detected type", value: "Directory" },
    {
      label: "Entries",
      value: !hasUsableDirectory
        ? "Load failed"
        : `${directory.items.length}${directory.truncated ? "+" : ""}`,
      mono: true,
    },
    { label: "Observed", value: formatShanghaiTime(directory.observedAt), mono: true },
    { label: "Preview", value: "Not applicable" },
  ];

  return (
    <div className="inspection-grid">
      <section
        className="index-pane"
        aria-label="Workspace files"
        aria-busy={directoryState === "loading"}
      >
        <div
          className="workspace-root"
          ref={directoryRootRef}
          aria-label={`Current workspace directory ${directory.path || "root"}`}
          tabIndex={-1}
        >
          <FolderRoot aria-hidden="true" size={17} />
          <span><small>APPROVED ROOT</small>{directory.path ? `<WORKSPACE_ROOT> / ${directory.path}` : "<WORKSPACE_ROOT>"}</span>
        </div>
        {directory.parentPath !== null ? (
          <Button className="directory-back" onClick={() => void openDirectory(directory.parentPath!)}>
            <ArrowLeft aria-hidden="true" size={14} /> Parent directory
          </Button>
        ) : null}
        {directoryState === "loading" ? <SourceState kind="loading" detail="Loading the selected directory." /> : null}
        {directoryState === "error" ? (
          <SourceState kind="error" detail={directoryFailure ?? "The selected directory could not be safely loaded."} />
        ) : null}
        {directoryState === "idle" && directory.items.length === 0 ? (
          <SourceState kind="empty" detail="The approved directory contains no visible entries." />
        ) : null}
        {directory.items.length > 0 ? (
          <ul className="index-list file-list">
            {directory.items.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  className={cn("index-row", entry.path === selectedFile?.path && "is-selected")}
                  onClick={() => entry.entryType === "directory"
                    ? void openDirectory(entry.path)
                    : void openFile(entry)}
                  aria-pressed={entry.path === selectedFile?.path}
                >
                  {entry.entryType === "directory"
                    ? <Folder aria-hidden="true" size={16} />
                    : entry.previewState === "available"
                      ? <FileText aria-hidden="true" size={16} />
                      : <File aria-hidden="true" size={16} />}
                  <span><strong>{entry.name}</strong><small>{entry.kind} · {entry.size}</small></span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {directory.truncated ? <p className="truncation-note">Directory listing is bounded to 500 visible entries.</p> : null}
      </section>

      <article
        className="preview-pane"
        aria-labelledby="file-title"
        aria-busy={previewState === "loading"}
      >
        <div className="preview-toolbar">
          <div>
            <p className="eyebrow">{selectedFile?.kind ?? "WORKSPACE PREVIEW"}</p>
            <h2 id="file-title" ref={previewTitleRef} tabIndex={-1}>{selectedFile?.name ?? "Select a file"}</h2>
          </div>
        </div>
        {previewState === "loading" ? <SourceState kind="loading" detail="Loading a bounded file preview." /> : null}
        {previewState === "error" ? (
          <SourceState kind="error" detail={previewFailure ?? "The selected file could not be safely previewed."} />
        ) : null}
        {previewState === "idle" && selectedFile?.content !== undefined ? (
          <>
            <SearchField label="Search this file" value={query} onChange={setQuery} resultCount={matches} />
            {selectedFile.kind === "Markdown"
              ? <SafeMarkdown ariaLabel={`${selectedFile.name} preview`} content={selectedFile.content} query={query} />
              : (
                <pre
                  className="document-preview"
                  role="region"
                  aria-label={`${selectedFile.name} preview`}
                  tabIndex={0}
                >
                  <HighlightedText text={selectedFile.content} query={query} />
                </pre>
              )}
            {selectedFile.truncated ? <p className="truncation-note">File preview is bounded.</p> : null}
          </>
        ) : null}
        {previewState === "idle" && selectedFile && selectedFile.content === undefined ? (
          <div className="unavailable-preview">
            <LockKeyhole aria-hidden="true" size={24} />
            <h3>Preview not available</h3>
            <p>This file remains visible as metadata, but its type or size is not rendered in Cockpit.</p>
          </div>
        ) : null}
        {previewState === "idle" && !selectedFile ? (
          <SourceState kind="empty" detail="Choose a file or open a directory from the approved workspace." />
        ) : null}
      </article>

      <div className="ledger-column">
        <SourceLedger title="File metadata" items={currentLedger} />
        <p className="exclusion-note">Dotfiles, credential artifacts, and escaping symlinks are omitted before listing.</p>
      </div>
    </div>
  );
}
