import "server-only";

import { codexSystemSnapshotSchema, type CodexSystemSnapshot } from "@/contracts/codex";
import { SAFE_ERROR_MESSAGES, safePublicMessageSchema } from "@/contracts/agents";
import { codexAppServerReader, type CodexAppServerReader } from "@/server/codex/app-server-reader";
import {
  codexGuidanceFailureSources,
  loadCodexGuidanceSources,
  type CodexGuidanceSource,
} from "@/server/codex/guidance";
import type { CodexPanelDescriptor } from "@/server/panels/registry";
import { classifySourceError, SourceSecurityError } from "@/server/security/errors";

export interface LoadCodexSystemOptions {
  readonly now?: Date;
  readonly signal?: AbortSignal;
}

interface CodexSystemDependencies {
  readonly reader: Pick<CodexAppServerReader, "probe">;
  readonly guidance: (panel: CodexPanelDescriptor) => Promise<CodexGuidanceSource[]>;
}

const productionDependencies: CodexSystemDependencies = Object.freeze({
  reader: codexAppServerReader,
  guidance: loadCodexGuidanceSources,
});

function invoke<T>(operation: () => Promise<T>): Promise<T> {
  return Promise.resolve().then(operation);
}

function runtimeFailure(error: unknown): CodexSystemSnapshot["runtime"] {
  const code = classifySourceError(error);
  return {
    label: "Codex CLI",
    state: code === "missing_source" ? "unavailable" : "error",
    message: safePublicMessageSchema.parse(SAFE_ERROR_MESSAGES[code]),
  };
}

function createService(dependencies: CodexSystemDependencies) {
  return async function load(
    panel: CodexPanelDescriptor,
    options: LoadCodexSystemOptions = {},
  ): Promise<CodexSystemSnapshot> {
    const now = options.now ?? new Date();
    const signalOption = options.signal ? { signal: options.signal } : {};
    const [runtimeResult, guidanceResult] = await Promise.allSettled([
      invoke(() => dependencies.reader.probe(panel, signalOption)),
      invoke(() => dependencies.guidance(panel)),
    ]);
    const runtime: CodexSystemSnapshot["runtime"] =
      runtimeResult.status === "fulfilled"
        ? { label: "Codex CLI", state: "ready", version: runtimeResult.value.version }
        : runtimeFailure(runtimeResult.reason);
    const sources =
      guidanceResult.status === "fulfilled"
        ? guidanceResult.value
        : codexGuidanceFailureSources(panel, "error");
    return codexSystemSnapshotSchema.parse({
      runtime,
      sources,
      observedAt: now.toISOString(),
    });
  };
}

const loadSystem = createService(productionDependencies);

export function loadCodexSystemSnapshot(
  panel: CodexPanelDescriptor,
  options: LoadCodexSystemOptions = {},
): Promise<CodexSystemSnapshot> {
  return loadSystem(panel, options);
}

/** Narrow synthetic-test seam; production dependencies remain fixed. */
export function createCodexSystemServiceForTest(
  dependencies: Partial<CodexSystemDependencies>,
): ReturnType<typeof createService> {
  if (process.env.NODE_ENV !== "test") throw new SourceSecurityError("source_unavailable");
  return createService(Object.freeze({ ...productionDependencies, ...dependencies }));
}

export type { CodexSystemDependencies as CodexSystemTestDependencies };
