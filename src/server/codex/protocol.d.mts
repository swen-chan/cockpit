import type { ProcessSample } from "./owned-process.mjs";
export interface ProtocolOptions {
  command: string;
  argvPrefix?: string[];
  home: string;
  owner?: {
    recordProcess(record: {
      pid: number;
      pgid: number;
      executableIdentity: string;
      startToken: string;
    }): void | Promise<unknown>;
  };
  signal?: AbortSignal;
  sampleGroup?: (pgid: number) => Promise<ProcessSample>;
}
export interface Metrics {
  stdoutBytes: number;
  stderrBytes: number;
  peakRssKiB: number;
  samples: number;
  closed: boolean;
}
export function probeVersion(
  options: ProtocolOptions,
): Promise<{ version: "0.145.0"; metrics: Metrics }>;
export function exchangeAppServer(
  options: ProtocolOptions & {
    kind: "list" | "read";
    taskId?: string;
    copiedRowExists?: boolean;
    cursor?: string | null;
  },
): Promise<{ result: unknown; metrics: Metrics }>;
