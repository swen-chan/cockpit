export interface ProcessSample {
  rssKiB: number;
  members: number;
}
export interface ProcessApi {
  send(message: unknown): void;
  complete(value: unknown): void;
  deadline(ms: number): void;
  stop(code: string): void;
}
export function sterileEnvironment(home: string, app?: boolean): Record<string, string>;
export function sampleOwnedGroup(pgid: number): Promise<ProcessSample>;
export function runOwnedProcess(options: {
  command: string;
  args: string[];
  home: string;
  app?: boolean;
  owner?: {
    recordProcess(record: {
      pid: number;
      pgid: number;
      executableIdentity: string;
      startToken: string;
    }): void | Promise<unknown>;
  };
  signal?: AbortSignal;
  lifetimeMs: number;
  stdoutCap?: number;
  stderrCap?: number;
  combinedCap?: number;
  onData(bytes: Buffer, api: ProcessApi): void;
  onStart(api: ProcessApi): void;
  onEnd?(api: ProcessApi): void;
  sampleGroup?: (pgid: number) => Promise<ProcessSample>;
}): Promise<{
  value: unknown;
  metrics: {
    stdoutBytes: number;
    stderrBytes: number;
    peakRssKiB: number;
    samples: number;
    closed: boolean;
  };
}>;
