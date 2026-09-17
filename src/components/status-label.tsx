import { AlertTriangle, Check, CirclePause, LoaderCircle } from "lucide-react";

type Status =
  | "ready"
  | "success"
  | "failed"
  | "error"
  | "running"
  | "paused"
  | "completed"
  | "unknown"
  | "never"
  | "unavailable";

export function StatusLabel({ label, status }: { label?: string | undefined; status: Status }) {
  const Icon =
    status === "success" || status === "ready" || status === "completed"
      ? Check
      : status === "failed" || status === "error" || status === "unavailable"
        ? AlertTriangle
        : status === "running"
          ? LoaderCircle
          : CirclePause;

  return (
    <span className={`status-label status-${status}`}>
      <Icon aria-hidden="true" size={13} />
      {label ?? status}
    </span>
  );
}
