import { AlertTriangle, CircleOff, LoaderCircle } from "lucide-react";

type StateKind = "loading" | "empty" | "unavailable" | "error";

const defaults: Record<StateKind, { title: string; detail: string }> = {
  loading: { title: "Reading source", detail: "Cockpit is waiting for this local source." },
  empty: { title: "Nothing to display", detail: "The source is available but contains no eligible records." },
  unavailable: { title: "Source unavailable", detail: "Other Cockpit sections can continue independently." },
  error: { title: "Source could not be read", detail: "The diagnostic is intentionally bounded and contains no source content." },
};

export function SourceState({ detail, kind, title }: { kind: StateKind; title?: string; detail?: string }) {
  const Icon = kind === "loading" ? LoaderCircle : kind === "empty" ? CircleOff : AlertTriangle;
  const copy = defaults[kind];
  return (
    <section className={`source-state source-state-${kind}`} role={kind === "error" ? "alert" : "status"} aria-live="polite">
      <Icon aria-hidden="true" size={20} />
      <div><h2>{title ?? copy.title}</h2><p>{detail ?? copy.detail}</p></div>
    </section>
  );
}
