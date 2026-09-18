import { HighlightedText } from "@/components/highlighted-text";
import { StatusLabel } from "@/components/status-label";
import type { SafeProcessRow, SafeProcessTimeline } from "@/contracts/codex";

function nestedDisclosureKey(turnKey: string, row: SafeProcessRow): string {
  return `${turnKey}:${row.key}:${row.type === "command" ? "output" : "patch"}`;
}

function processRowText(
  row: SafeProcessRow,
  nestedOpen: ReadonlySet<string>,
  turnKey: string,
): string[] {
  if (row.type === "progress" || row.type === "reasoning_summary" || row.type === "plan") {
    return [row.text];
  }
  if (row.type === "command") {
    return [
      row.preview,
      nestedOpen.has(nestedDisclosureKey(turnKey, row)) ? row.output?.text : undefined,
    ].filter((value): value is string => value !== undefined);
  }
  if (row.type === "tool") return row.fields.map((field) => field.value);
  if (row.type === "changes") {
    return [
      ...row.files.map((file) => file.path),
      nestedOpen.has(nestedDisclosureKey(turnKey, row)) ? row.patch?.text : undefined,
    ].filter((value): value is string => value !== undefined);
  }
  return [];
}

export function visibleProcessSearchText(
  timeline: SafeProcessTimeline | null,
  turnKey: string,
  processOpen: ReadonlySet<string>,
  nestedOpen: ReadonlySet<string>,
): string {
  if (!timeline || !processOpen.has(turnKey)) return "";
  return timeline.rows.flatMap((row) => processRowText(row, nestedOpen, turnKey)).join("\n");
}

function terminalStatus(status: "completed" | "failed" | "declined") {
  return status === "declined" ? (
    <StatusLabel status="paused" label="declined" />
  ) : (
    <StatusLabel status={status} />
  );
}

function durationLabel(durationMs: number | undefined): string | null {
  if (durationMs === undefined) return null;
  return `${durationMs.toLocaleString("en-US")} ms`;
}

function OmissionNotes({ timeline }: { timeline: SafeProcessTimeline }) {
  if (timeline.omitted.length === 0) return null;
  return (
    <ul className="process-omission-list" aria-label="Omitted Process content">
      {timeline.omitted.map((omitted, index) => (
        <li key={`${omitted.reason}-${index}`}>
          {omitted.label}
          {omitted.count ? ` / ${omitted.count}` : ""}
        </li>
      ))}
    </ul>
  );
}

function ProcessRow({
  onNestedToggle,
  query,
  row,
  turnKey,
}: {
  onNestedToggle: (key: string, open: boolean) => void;
  query: string;
  row: SafeProcessRow;
  turnKey: string;
}) {
  if (row.type === "progress" || row.type === "reasoning_summary" || row.type === "plan") {
    const label =
      row.type === "progress"
        ? "Progress"
        : row.type === "reasoning_summary"
          ? "Reasoning summary"
          : "Plan";
    return (
      <li className="process-row">
        <span className="process-row-label">{label}</span>
        <p>
          <HighlightedText text={row.text} query={query} />
        </p>
      </li>
    );
  }

  if (row.type === "command") {
    const detailKey = nestedDisclosureKey(turnKey, row);
    return (
      <li className="process-row">
        <div className="process-row-heading">
          <span className="process-row-label">Command</span>
          {terminalStatus(row.status)}
        </div>
        {row.preview ? (
          <p>
            <HighlightedText text={row.preview} query={query} />
          </p>
        ) : null}
        <dl className="process-row-meta">
          {durationLabel(row.durationMs) ? (
            <div>
              <dt>Duration</dt>
              <dd>{durationLabel(row.durationMs)}</dd>
            </div>
          ) : null}
          {row.exitCode !== undefined ? (
            <div>
              <dt>Exit</dt>
              <dd>{row.exitCode}</dd>
            </div>
          ) : null}
        </dl>
        {row.output ? (
          <details
            className="process-detail"
            onToggle={(event) => onNestedToggle(detailKey, event.currentTarget.open)}
          >
            <summary className="process-detail-summary">Output</summary>
            <pre>
              <code>
                <HighlightedText text={row.output.text} query={query} />
              </code>
            </pre>
            {row.output.truncated ? (
              <p className="process-detail-note">Output excerpt is bounded.</p>
            ) : null}
          </details>
        ) : null}
      </li>
    );
  }

  if (row.type === "tool") {
    return (
      <li className="process-row">
        <div className="process-row-heading">
          <span className="process-row-label">Tool</span>
          {row.status ? terminalStatus(row.status) : null}
        </div>
        <strong>{row.label}</strong>
        {row.fields.length > 0 ? (
          <dl className="process-tool-fields">
            {row.fields.map((field) => (
              <div key={`${field.label}-${field.value}`}>
                <dt>{field.label}</dt>
                <dd>
                  <HighlightedText text={field.value} query={query} />
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {durationLabel(row.durationMs) ? (
          <p className="process-duration">{durationLabel(row.durationMs)}</p>
        ) : null}
      </li>
    );
  }

  if (row.type === "changes") {
    const detailKey = nestedDisclosureKey(turnKey, row);
    return (
      <li className="process-row">
        <div className="process-row-heading">
          <span className="process-row-label">Changes</span>
          {terminalStatus(row.status)}
        </div>
        <ul className="process-file-list">
          {row.files.map((file) => (
            <li key={`${file.change}-${file.path}`}>
              <span>{file.change}</span>
              <code>
                <HighlightedText text={file.path} query={query} />
              </code>
            </li>
          ))}
        </ul>
        {row.patch ? (
          <details
            className="process-detail"
            onToggle={(event) => onNestedToggle(detailKey, event.currentTarget.open)}
          >
            <summary className="process-detail-summary">Patch</summary>
            <pre>
              <code>
                <HighlightedText text={row.patch.text} query={query} />
              </code>
            </pre>
            {row.patch.truncated ? (
              <p className="process-detail-note">Patch excerpt is bounded.</p>
            ) : null}
          </details>
        ) : null}
      </li>
    );
  }

  return (
    <li className="process-row process-row-hidden">
      <div className="process-row-heading">
        <span className="process-row-label">{row.label}</span>
        {row.status ? terminalStatus(row.status) : null}
      </div>
      <p>
        {row.itemType} / {row.count} item{row.count === 1 ? "" : "s"}
      </p>
    </li>
  );
}

export function CodexProcessTimeline({
  onNestedToggle,
  onProcessToggle,
  query,
  timeline,
  turnKey,
}: {
  onNestedToggle: (key: string, open: boolean) => void;
  onProcessToggle: (key: string, open: boolean) => void;
  query: string;
  timeline: SafeProcessTimeline;
  turnKey: string;
}) {
  const itemLabel = `${timeline.count} item${timeline.count === 1 ? "" : "s"}`;
  return (
    <details
      className="process-disclosure"
      onToggle={(event) => onProcessToggle(turnKey, event.currentTarget.open)}
    >
      <summary className="process-summary" aria-label={`Process, ${itemLabel}`}>
        <span>PROCESS</span>
        <strong>{timeline.count.toString().padStart(2, "0")}</strong>
      </summary>
      <ol className="process-timeline">
        {timeline.rows.map((row) => (
          <ProcessRow
            key={row.key}
            onNestedToggle={onNestedToggle}
            query={query}
            row={row}
            turnKey={turnKey}
          />
        ))}
      </ol>
      <OmissionNotes timeline={timeline} />
    </details>
  );
}
