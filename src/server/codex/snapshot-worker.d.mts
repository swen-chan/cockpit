export type SnapshotInput = {
  sourceDatabase: string;
  destinationDatabase: string;
  placeholder: string;
} & (
  | { selectedTaskId?: never; allowedRolloutRoots?: never; destinationRollout?: never }
  | {
      selectedTaskId: string;
      allowedRolloutRoots: readonly string[];
      destinationRollout: string;
    }
);

export type SnapshotResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "missing_source"
        | "protocol_violation"
        | "source_busy"
        | "source_malformed"
        | "source_too_large"
        | "source_unavailable";
    };

export interface VerifyCopiedTaskInput {
  operation: "verify-copied-task";
  database: string;
  rollout: string;
  taskId: string;
}

export function createSnapshot(
  input: SnapshotInput,
  options?: {
    signal?: AbortSignal;
    /** Synthetic test seam. Production callers never supply this callback. */
    onPhase?: (phase: "before-source-postflight") => void | Promise<void>;
  },
): Promise<SnapshotResult>;

export function verifyCopiedTask(
  input: VerifyCopiedTaskInput,
  options?: {
    signal?: AbortSignal;
  },
): Promise<SnapshotResult>;
