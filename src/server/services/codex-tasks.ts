import "server-only";

import { homedir } from "node:os";

import {
  codexAppServerReader,
  type CodexAppServerReader,
  type CodexRuntimeObservation,
} from "@/server/codex/app-server-reader";
import { projectCodexTaskDetail, projectCodexTaskPage } from "@/server/codex/task-projection";
import {
  panelTokenCodec,
  type PanelTokenCodec,
  type PanelTokenScope,
} from "@/server/panels/opaque-token";
import type { CodexPanelDescriptor } from "@/server/panels/registry";
import { SourceSecurityError } from "@/server/security/errors";
import { assertSourceReadAllowed } from "@/server/security/prerender-guard";

export interface LoadCodexTaskPageOptions {
  readonly cursor?: string | null;
  readonly signal?: AbortSignal;
}

export interface LoadCodexTaskDetailOptions {
  readonly signal?: AbortSignal;
}

type CodexTaskPage = ReturnType<typeof projectCodexTaskPage>;

export type CodexTaskListObservation = Readonly<{
  runtime: CodexRuntimeObservation;
  tasks:
    | { readonly state: "ready"; readonly page: CodexTaskPage }
    | { readonly state: "failed"; readonly code: SourceSecurityError["code"] };
}>;

export interface CodexTasksService {
  list(
    panel: CodexPanelDescriptor,
    options?: LoadCodexTaskPageOptions,
  ): Promise<ReturnType<typeof projectCodexTaskPage>>;
  observeList(
    panel: CodexPanelDescriptor,
    options?: LoadCodexTaskPageOptions,
  ): Promise<CodexTaskListObservation>;
  detail(
    panel: CodexPanelDescriptor,
    publicTaskId: string,
    options?: LoadCodexTaskDetailOptions,
  ): Promise<ReturnType<typeof projectCodexTaskDetail>>;
}

interface CodexTasksDependencies {
  readonly reader: CodexAppServerReader;
  readonly tokens: PanelTokenCodec;
  readonly now: () => Date;
  readonly homedir: () => string;
}

const productionDependencies: CodexTasksDependencies = Object.freeze({
  reader: codexAppServerReader,
  tokens: panelTokenCodec,
  now: () => new Date(),
  homedir,
});

function tokenScope(panel: CodexPanelDescriptor): PanelTokenScope {
  return Object.freeze({
    panelId: panel.id,
    runtime: panel.runtime,
    adapterVersion: panel.adapterVersion,
  });
}

function projectionFailure(error: unknown): never {
  if (error instanceof SourceSecurityError) throw error;
  throw new SourceSecurityError("protocol_violation");
}

function projectionFailureCode(error: unknown): SourceSecurityError["code"] {
  return error instanceof SourceSecurityError ? error.code : "protocol_violation";
}

function rawCursor(
  panel: CodexPanelDescriptor,
  options: LoadCodexTaskPageOptions,
  tokens: PanelTokenCodec,
): string | null {
  const publicCursor = options.cursor ?? null;
  return publicCursor === null ? null : tokens.decodeCursor(tokenScope(panel), publicCursor);
}

function projectPage(
  result: unknown,
  panel: CodexPanelDescriptor,
  dependencies: CodexTasksDependencies,
): CodexTaskPage {
  return projectCodexTaskPage(result, {
    panel,
    tokens: dependencies.tokens,
    now: dependencies.now(),
    operatorHome: dependencies.homedir(),
  });
}

function createService(dependencies: CodexTasksDependencies): CodexTasksService {
  const service: CodexTasksService = {
    async list(panel, options = {}) {
      const signalOption = options.signal ? { signal: options.signal } : {};
      const result = await dependencies.reader.list(panel, {
        cursor: rawCursor(panel, options, dependencies.tokens),
        ...signalOption,
      });
      try {
        return projectPage(result, panel, dependencies);
      } catch (error) {
        return projectionFailure(error);
      }
    },

    async observeList(panel, options = {}) {
      const signalOption = options.signal ? { signal: options.signal } : {};
      const observation = await dependencies.reader.observeList(panel, {
        cursor: rawCursor(panel, options, dependencies.tokens),
        ...signalOption,
      });
      if (observation.tasks.state === "failed") {
        return Object.freeze({ runtime: observation.runtime, tasks: observation.tasks });
      }
      try {
        return Object.freeze({
          runtime: observation.runtime,
          tasks: Object.freeze({
            state: "ready" as const,
            page: projectPage(observation.tasks.result, panel, dependencies),
          }),
        });
      } catch (error) {
        return Object.freeze({
          runtime: observation.runtime,
          tasks: Object.freeze({ state: "failed" as const, code: projectionFailureCode(error) }),
        });
      }
    },

    async detail(panel, publicTaskId, options = {}) {
      const scope = tokenScope(panel);
      const rawTaskId = dependencies.tokens.decodeTask(scope, publicTaskId);
      const signalOption = options.signal ? { signal: options.signal } : {};
      const result = await dependencies.reader.read(panel, rawTaskId, signalOption);
      try {
        return projectCodexTaskDetail(result, {
          panel,
          publicTaskId,
          expectedRawTaskId: rawTaskId,
          now: dependencies.now(),
          operatorHome: dependencies.homedir(),
        });
      } catch (error) {
        return projectionFailure(error);
      }
    },
  };
  return Object.freeze(service);
}

const codexTasksService = createService(productionDependencies);

export function loadCodexTaskPage(
  panel: CodexPanelDescriptor,
  options: LoadCodexTaskPageOptions = {},
): Promise<ReturnType<typeof projectCodexTaskPage>> {
  assertSourceReadAllowed();
  return codexTasksService.list(panel, options);
}

export function observeCodexTaskList(
  panel: CodexPanelDescriptor,
  options: LoadCodexTaskPageOptions = {},
): Promise<CodexTaskListObservation> {
  assertSourceReadAllowed();
  return codexTasksService.observeList(panel, options);
}

export function loadCodexTaskDetail(
  panel: CodexPanelDescriptor,
  publicTaskId: string,
  options: LoadCodexTaskDetailOptions = {},
): Promise<ReturnType<typeof projectCodexTaskDetail>> {
  assertSourceReadAllowed();
  return codexTasksService.detail(panel, publicTaskId, options);
}

/** Narrow test-only composition seam; production dependencies cannot be replaced. */
export function createCodexTasksServiceForTest(
  dependencies: Partial<CodexTasksDependencies>,
): CodexTasksService {
  if (process.env.NODE_ENV !== "test") throw new SourceSecurityError("source_unavailable");
  return createService(Object.freeze({ ...productionDependencies, ...dependencies }));
}

export type { CodexTasksDependencies as CodexTasksTestDependencies };
