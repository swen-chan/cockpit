import "server-only";

import { chmodSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";

import { scopedSafeErrorCodeSchema, type ScopedSafeErrorCode } from "@/contracts/agents";
import type { CodexPanelDescriptor } from "@/server/panels/registry";
import { SourceSecurityError } from "@/server/security/errors";

import {
  codexContextResolver,
  type CodexContextResolver,
  type ResolvedCodexSource,
} from "./context";
import { createOwnedTemp, type OwnedTemp } from "./owned-temp.mjs";
import { exchangeAppServer, probeVersion } from "./protocol.mjs";
import { createStateSnapshot, verifyCopiedTask } from "./state-snapshot.mjs";

interface ReaderOptions {
  readonly signal?: AbortSignal;
}

interface ListOptions extends ReaderOptions {
  readonly cursor?: string | null;
}

export type CodexRuntimeObservation =
  | { readonly state: "ready"; readonly version: "0.145.0" }
  | { readonly state: "failed"; readonly code: ScopedSafeErrorCode };

export type CodexListObservation = Readonly<{
  runtime: CodexRuntimeObservation;
  tasks:
    | { readonly state: "ready"; readonly result: unknown }
    | { readonly state: "failed"; readonly code: ScopedSafeErrorCode };
}>;

export interface CodexAppServerReader {
  list(panel: CodexPanelDescriptor, options?: ListOptions): Promise<unknown>;
  observeList(panel: CodexPanelDescriptor, options?: ListOptions): Promise<CodexListObservation>;
  probe(
    panel: CodexPanelDescriptor,
    options?: ReaderOptions,
  ): Promise<{ readonly version: "0.145.0" }>;
  read(panel: CodexPanelDescriptor, taskId: string, options?: ReaderOptions): Promise<unknown>;
}

interface ReaderDependencies {
  readonly context: CodexContextResolver;
  readonly createOwnedTemp: () => OwnedTemp;
  readonly probeVersion: typeof probeVersion;
  readonly createStateSnapshot: typeof createStateSnapshot;
  readonly exchangeAppServer: typeof exchangeAppServer;
  readonly verifyCopiedTask: typeof verifyCopiedTask;
}

const productionDependencies: ReaderDependencies = Object.freeze({
  context: codexContextResolver,
  createOwnedTemp: () => createOwnedTemp(),
  probeVersion,
  createStateSnapshot,
  exchangeAppServer,
  verifyCopiedTask,
});

function normalizeFailure(error: unknown, readExchangeResourceLimit = false): SourceSecurityError {
  if (error instanceof SourceSecurityError) return error;
  if (
    readExchangeResourceLimit &&
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "resource_limit"
  ) {
    return new SourceSecurityError("source_too_large");
  }
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? scopedSafeErrorCodeSchema.safeParse(error.code)
      : undefined;
  return new SourceSecurityError(code?.success ? code.data : "source_unavailable");
}

function assertFixedPanel(panel: CodexPanelDescriptor): void {
  if (
    panel.id !== "codex" ||
    panel.name !== "Codex" ||
    panel.runtime !== "codex" ||
    panel.adapterVersion !== "codex-0.145.0"
  ) {
    throw new SourceSecurityError("source_malformed");
  }
}

function prepareOperationHome(owner: OwnedTemp): void {
  const directory = path.join(owner.directory, "tmp");
  try {
    mkdirSync(directory, { mode: 0o700 });
    chmodSync(directory, 0o700);
    const stat = lstatSync(directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o7777) !== 0o700 ||
      typeof process.geteuid !== "function" ||
      stat.uid !== process.geteuid() ||
      realpathSync(directory) !== directory
    ) {
      throw new Error();
    }
  } catch {
    throw new SourceSecurityError("source_unavailable");
  }
}

function createReader(dependencies: ReaderDependencies): CodexAppServerReader {
  let active = false;
  let poisoned = false;

  type Operation = Readonly<
    { kind: "probe" } | { kind: "list"; cursor: string | null } | { kind: "read"; taskId: string }
  >;
  type OperationOutcome =
    | { readonly ok: true; readonly result: unknown; readonly version: "0.145.0" }
    | {
        readonly ok: false;
        readonly error: SourceSecurityError;
        readonly version: "0.145.0" | null;
      };

  async function operate(
    panel: CodexPanelDescriptor,
    operation: Operation,
    signal: AbortSignal | undefined,
  ): Promise<OperationOutcome> {
    if (poisoned) {
      return { ok: false, error: new SourceSecurityError("source_unavailable"), version: null };
    }
    try {
      assertFixedPanel(panel);
    } catch (error) {
      return { ok: false, error: normalizeFailure(error), version: null };
    }
    if (signal?.aborted) {
      return { ok: false, error: new SourceSecurityError("source_unavailable"), version: null };
    }
    if (active) return { ok: false, error: new SourceSecurityError("source_busy"), version: null };
    active = true;
    let owner: OwnedTemp | undefined;
    let failure: SourceSecurityError | undefined;
    let result: unknown;
    let completed = false;
    let version: "0.145.0" | null = null;
    try {
      owner = dependencies.createOwnedTemp();
      prepareOperationHome(owner);
      if (signal?.aborted) throw new SourceSecurityError("source_unavailable");
      const executable = await dependencies.context.resolveExecutable(panel);
      const signalOption = signal ? { signal } : {};
      const probe = await dependencies.probeVersion({
        command: executable,
        home: owner.directory,
        owner,
        ...signalOption,
      });
      version = probe.version;
      if (signal?.aborted) throw new SourceSecurityError("source_unavailable");
      if (operation.kind === "probe") {
        result = Object.freeze({ version });
        completed = true;
      } else {
        const source: ResolvedCodexSource = await dependencies.context.resolveSource(
          panel,
          operation.kind,
        );
        if (signal?.aborted) throw new SourceSecurityError("source_unavailable");
        const snapshot =
          operation.kind === "list"
            ? await dependencies.createStateSnapshot({
                sourceDatabase: source.stateDatabase,
                owner,
                ...signalOption,
              })
            : await dependencies.createStateSnapshot({
                sourceDatabase: source.stateDatabase,
                selectedTaskId: operation.taskId,
                allowedRolloutRoots: [...source.rolloutRoots],
                owner,
                ...signalOption,
              });
        let response: Awaited<ReturnType<typeof exchangeAppServer>>;
        try {
          response =
            operation.kind === "list"
              ? await dependencies.exchangeAppServer({
                  command: executable,
                  home: owner.directory,
                  owner,
                  ...signalOption,
                  kind: "list",
                  cursor: operation.cursor,
                })
              : await dependencies.exchangeAppServer({
                  command: executable,
                  home: owner.directory,
                  owner,
                  ...signalOption,
                  kind: "read",
                  taskId: operation.taskId,
                  copiedRowExists: snapshot.copiedRowExists,
                });
        } catch (error) {
          throw normalizeFailure(error, operation.kind === "read");
        }
        if (operation.kind === "read") {
          if (snapshot.rollout === null) throw new SourceSecurityError("protocol_violation");
          await dependencies.verifyCopiedTask({
            owner,
            database: snapshot.database,
            rollout: snapshot.rollout,
            taskId: operation.taskId,
            ...signalOption,
          });
        }
        result = response.result;
        completed = true;
      }
    } catch (error) {
      failure = normalizeFailure(error);
    } finally {
      try {
        if (owner && !owner.cleanup()) {
          poisoned = true;
          failure ??= new SourceSecurityError("source_unavailable");
        }
      } catch {
        poisoned = true;
        failure ??= new SourceSecurityError("source_unavailable");
      } finally {
        active = false;
      }
    }
    if (failure) return { ok: false, error: failure, version };
    if (!completed || version === null) {
      return { ok: false, error: new SourceSecurityError("source_unavailable"), version };
    }
    return { ok: true, result, version };
  }

  async function observeList(
    panel: CodexPanelDescriptor,
    options: ListOptions = {},
  ): Promise<CodexListObservation> {
    const outcome = await operate(
      panel,
      { kind: "list", cursor: options.cursor ?? null },
      options.signal,
    );
    if (outcome.ok) {
      return Object.freeze({
        runtime: Object.freeze({ state: "ready" as const, version: outcome.version }),
        tasks: Object.freeze({ state: "ready" as const, result: outcome.result }),
      });
    }
    const failed = Object.freeze({ state: "failed" as const, code: outcome.error.code });
    return Object.freeze({
      runtime:
        outcome.version === null
          ? failed
          : Object.freeze({ state: "ready" as const, version: outcome.version }),
      tasks: failed,
    });
  }

  const reader: CodexAppServerReader = {
    async list(panel: CodexPanelDescriptor, options: ListOptions = {}) {
      const observation = await observeList(panel, options);
      if (observation.tasks.state === "failed") {
        throw new SourceSecurityError(observation.tasks.code);
      }
      return observation.tasks.result;
    },
    observeList,
    async probe(panel: CodexPanelDescriptor, options: ReaderOptions = {}) {
      const outcome = await operate(panel, { kind: "probe" }, options.signal);
      if (!outcome.ok) throw outcome.error;
      return Object.freeze({ version: outcome.version });
    },
    async read(panel: CodexPanelDescriptor, taskId: string, options: ReaderOptions = {}) {
      const outcome = await operate(panel, { kind: "read", taskId }, options.signal);
      if (!outcome.ok) throw outcome.error;
      return outcome.result;
    },
  };
  return Object.freeze(reader);
}

export const codexAppServerReader: CodexAppServerReader = createReader(productionDependencies);

/** Narrow test-only composition seam; production dependencies cannot be replaced. */
export function createCodexAppServerReaderForTest(
  dependencies: Partial<ReaderDependencies>,
): CodexAppServerReader {
  if (process.env.NODE_ENV !== "test") throw new SourceSecurityError("source_unavailable");
  return createReader(Object.freeze({ ...productionDependencies, ...dependencies }));
}

export type { ReaderDependencies as CodexReaderTestDependencies };
