import "server-only";

import type { WorkspaceDirectory } from "@/contracts/cockpit";
import { codexOverviewSnapshotSchema, type CodexOverviewSnapshot } from "@/contracts/codex";
import {
  SAFE_ERROR_MESSAGES,
  safePublicMessageSchema,
  scopedSafeErrorCodeSchema,
  type ScopedSafeErrorCode,
} from "@/contracts/agents";
import { loadCodexGuidanceSources, type CodexGuidanceSource } from "@/server/codex/guidance";
import { readWorkspaceDirectory } from "@/server/adapters/files";
import type { CodexPanelDescriptor } from "@/server/panels/registry";
import { classifySourceError, SourceSecurityError } from "@/server/security/errors";
import { observeCodexTaskList, type CodexTaskListObservation } from "@/server/services/codex-tasks";

export interface LoadCodexOverviewOptions {
  readonly now?: Date;
  readonly signal?: AbortSignal;
}

interface CodexOverviewDependencies {
  readonly tasks: (
    panel: CodexPanelDescriptor,
    options: { readonly signal?: AbortSignal },
  ) => Promise<CodexTaskListObservation>;
  readonly guidance: (panel: CodexPanelDescriptor) => Promise<CodexGuidanceSource[]>;
  readonly workspace: (root: string, now: Date) => Promise<WorkspaceDirectory>;
}

const productionDependencies: CodexOverviewDependencies = Object.freeze({
  tasks: observeCodexTaskList,
  guidance: loadCodexGuidanceSources,
  workspace: (root: string, now: Date) => readWorkspaceDirectory(root, "", now),
});

function invoke<T>(operation: () => Promise<T>): Promise<T> {
  return Promise.resolve().then(operation);
}

function failure(
  error: unknown,
  now: Date,
): Extract<CodexOverviewSnapshot["runtime"], { state: "unavailable" | "error" }> {
  const parsedCode = scopedSafeErrorCodeSchema.safeParse(error);
  const code: ScopedSafeErrorCode = parsedCode.success
    ? parsedCode.data
    : classifySourceError(error);
  return {
    state: code === "missing_source" ? "unavailable" : "error",
    observedAt: now.toISOString(),
    message: safePublicMessageSchema.parse(SAFE_ERROR_MESSAGES[code]),
  };
}

function validTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function workspaceSection(
  directory: WorkspaceDirectory,
): Extract<CodexOverviewSnapshot["workspace"], { state: "ready" }> {
  return {
    state: "ready",
    observedAt: directory.observedAt,
    loadedCount: directory.items.length,
    truncated: directory.truncated,
    items: directory.items
      .filter((entry) => entry.entryType === "file")
      .sort(
        (left, right) =>
          validTimestamp(right.modifiedAt) - validTimestamp(left.modifiedAt) ||
          left.name.localeCompare(right.name),
      )
      .slice(0, 4)
      .map((entry) => ({
        name: entry.name,
        kind: entry.kind,
        size: entry.size,
        modifiedAt: entry.modifiedAt,
      })),
  };
}

function createService(dependencies: CodexOverviewDependencies) {
  return async function load(
    panel: CodexPanelDescriptor,
    options: LoadCodexOverviewOptions = {},
  ): Promise<CodexOverviewSnapshot> {
    const now = options.now ?? new Date();
    const signalOption = options.signal ? { signal: options.signal } : {};
    const workspaceRoot = panel.configuration.workspaceRoot;
    const [taskResult, guidanceResult, workspaceResult] = await Promise.allSettled([
      invoke(() => dependencies.tasks(panel, signalOption)),
      invoke(() => dependencies.guidance(panel)),
      workspaceRoot
        ? invoke(() => dependencies.workspace(workspaceRoot, now))
        : Promise.resolve(null),
    ]);

    let runtime: CodexOverviewSnapshot["runtime"];
    let tasks: CodexOverviewSnapshot["tasks"];
    if (taskResult.status === "rejected") {
      runtime = failure(taskResult.reason, now);
      tasks = failure(taskResult.reason, now);
    } else {
      runtime =
        taskResult.value.runtime.state === "ready"
          ? {
              state: "ready",
              observedAt: now.toISOString(),
              label: "Codex CLI",
              version: taskResult.value.runtime.version,
            }
          : failure(taskResult.value.runtime.code, now);
      tasks =
        taskResult.value.tasks.state === "ready"
          ? {
              state: "ready",
              observedAt: taskResult.value.tasks.page.observedAt,
              items: taskResult.value.tasks.page.items,
              hasMore: taskResult.value.tasks.page.nextCursor !== null,
            }
          : failure(taskResult.value.tasks.code, now);
    }

    const guidance: CodexOverviewSnapshot["guidance"] =
      guidanceResult.status === "fulfilled"
        ? {
            state: "ready",
            observedAt: now.toISOString(),
            items: guidanceResult.value.map((source) => ({
              label: source.label,
              state: source.state,
            })),
          }
        : failure(guidanceResult.reason, now);

    const workspace: CodexOverviewSnapshot["workspace"] =
      workspaceRoot === undefined
        ? { state: "unsupported", observedAt: now.toISOString(), message: "Files not configured" }
        : workspaceResult.status === "fulfilled" && workspaceResult.value !== null
          ? workspaceSection(workspaceResult.value)
          : failure(
              workspaceResult.status === "rejected" ? workspaceResult.reason : "source_unavailable",
              now,
            );

    return codexOverviewSnapshotSchema.parse({
      panelName: "Codex",
      observedAt: now.toISOString(),
      runtime,
      tasks,
      guidance,
      workspace,
    });
  };
}

const loadOverview = createService(productionDependencies);

export function loadCodexOverviewSnapshot(
  panel: CodexPanelDescriptor,
  options: LoadCodexOverviewOptions = {},
): Promise<CodexOverviewSnapshot> {
  return loadOverview(panel, options);
}

/** Narrow synthetic-test seam; production dependencies remain fixed. */
export function createCodexOverviewServiceForTest(
  dependencies: Partial<CodexOverviewDependencies>,
): ReturnType<typeof createService> {
  if (process.env.NODE_ENV !== "test") throw new SourceSecurityError("source_unavailable");
  return createService(Object.freeze({ ...productionDependencies, ...dependencies }));
}

export type { CodexOverviewDependencies as CodexOverviewTestDependencies };
