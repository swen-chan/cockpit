export interface OwnedProcess {
  pid: number;
  pgid: number;
  executableIdentity: string;
  startToken: string;
}

export interface OwnedTemp {
  directory: string;
  markerPath: string;
  recordProcess(record: OwnedProcess): void;
  cleanup(): boolean;
}

export function createOwnedTemp(options?: { parent?: string }): OwnedTemp;
/** Internal worker ownership validation; creates nothing and returns no marker data. */
export function assertOwnedTempDirectory(directory: string): void;
export function reapOwnedTemps(options?: {
  parent?: string;
  now?: number;
  maxEntries?: number;
  /** Test-only: false proves gone; true, undefined, or an error preserves the directory. */
  isLive?: (record: OwnedProcess) => boolean | undefined;
}): { examined: number; removed: number };
