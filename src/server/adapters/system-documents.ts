import "server-only";

import type { SystemSource } from "@/contracts/cockpit";
import { formatByteCount, sourceStateForCode } from "@/server/adapters/safe-values";
import { classifySourceError } from "@/server/security/errors";
import { readNamedTextSource } from "@/server/files/bounded-text";
import { redactBrowserText } from "@/server/security/redaction";

export interface SystemDocumentSpec {
  id: "memory" | "user" | "soul" | "agents";
  title: string;
  category: string;
  summary: string;
  root: string;
  relativePath: string;
  displayPath: string;
  sourceLabel: string;
}

function failureContent(state: "unavailable" | "error"): string {
  return state === "unavailable"
    ? "This named context source is not available for the resolved Hermes profile."
    : "Cockpit could not safely read this named context source.";
}

export function systemDocumentFailure(
  spec: Omit<SystemDocumentSpec, "root" | "relativePath">,
  state: "unavailable" | "error",
  code: string,
  now: Date = new Date(),
): SystemSource {
  return {
    id: spec.id,
    title: spec.title,
    category: spec.category,
    summary: spec.summary,
    content: failureContent(state),
    stamp: {
      id: spec.id,
      label: spec.sourceLabel,
      path: spec.displayPath,
      observedAt: now.toISOString(),
      state,
    },
    metadata: [
      { label: "Status", value: state === "unavailable" ? "Not available" : "Read failed" },
      { label: "Diagnostic", value: code, mono: true },
      { label: "Content", value: "Not sent to browser" },
    ],
  };
}

export async function readSystemDocument(
  spec: SystemDocumentSpec,
  now: Date = new Date(),
): Promise<SystemSource> {
  const observedAt = now.toISOString();
  try {
    const source = await readNamedTextSource(spec.root, spec.relativePath);
    return {
      id: spec.id,
      title: spec.title,
      category: spec.category,
      summary: spec.summary,
      content: redactBrowserText(source.text),
      stamp: {
        id: spec.id,
        label: spec.sourceLabel,
        path: spec.displayPath,
        observedAt,
        state: "ready",
        ...(source.truncated ? { truncated: true } : {}),
      },
      metadata: [
        { label: "Type", value: "Markdown" },
        { label: "Size", value: formatByteCount(source.originalBytes), mono: true },
        { label: "Modified", value: source.modifiedAt, mono: true },
        { label: "Preview", value: source.truncated ? "Bounded / truncated" : "Available" },
      ],
    };
  } catch (error) {
    const code = classifySourceError(error);
    const state = sourceStateForCode(code);
    return systemDocumentFailure(spec, state, code, now);
  }
}
