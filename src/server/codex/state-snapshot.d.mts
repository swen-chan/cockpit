import type { ProcessSample } from "./owned-process.mjs";
export function createStateSnapshot(options: {
  sourceDatabase: string;
  selectedTaskId?: string;
  allowedRolloutRoots?: string[];
  owner: {
    directory: string;
    recordProcess(record: {
      pid: number;
      pgid: number;
      executableIdentity: string;
      startToken: string;
    }): void | Promise<unknown>;
  };
  signal?: AbortSignal;
  sampleGroup?: (pgid: number) => Promise<ProcessSample>;
}): Promise<{
  database: string;
  placeholder: string;
  rollout: string | null;
  copiedRowExists: boolean;
}>;

export function verifyCopiedTask(options: {
  database: string;
  rollout: string;
  taskId: string;
  owner: {
    directory: string;
    recordProcess(record: {
      pid: number;
      pgid: number;
      executableIdentity: string;
      startToken: string;
    }): void | Promise<unknown>;
  };
  signal?: AbortSignal;
  sampleGroup?: (pgid: number) => Promise<ProcessSample>;
}): Promise<void>;
