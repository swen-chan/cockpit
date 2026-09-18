export interface StableRolloutCopyOptions {
  source: string;
  destination: string;
  allowedRoots: readonly string[];
  signal?: AbortSignal;
  /** Epoch milliseconds; cooperative only. The parent enforces its hard deadline. */
  deadline?: number;
  /** Synthetic test injection only; production callers omit this callback. */
  onChunk?: (progress: Readonly<{ attempt: number; bytesCopied: number }>) => void | Promise<void>;
}

export declare function copyStableRollout(options: StableRolloutCopyOptions): Promise<{
  bytesCopied: number;
  attempts: number;
}>;
