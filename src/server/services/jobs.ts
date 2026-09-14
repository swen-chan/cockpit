import "server-only";

import { homedir } from "node:os";
import path from "node:path";

import type { HermesJob, JobsSnapshot } from "@/contracts/cockpit";
import { readJobDefinitions, readRecentJobExecutions, type JobExecutionHistory } from "@/server/adapters/jobs";
import { sourceStateForCode } from "@/server/adapters/safe-values";
import { resolveHermesContextFromEnvironment, type HermesContext } from "@/server/config/hermes-context";
import {
  resolveSourceManifest,
  type JobsManifest,
  type PrivateSourceManifest,
} from "@/server/config/source-manifest";
import { SourceSecurityError, toSafeDiagnostic, type SafeDiagnostic } from "@/server/security/errors";

export interface JobsPageData extends JobsSnapshot {
  failures: SafeDiagnostic[];
}

export interface LoadJobsOptions {
  environment?: Readonly<Record<string, string | undefined>>;
  manifest?: PrivateSourceManifest;
  now?: Date;
  platformRoot?: string;
  definitionReader?: (context: HermesContext, manifest: JobsManifest) => Promise<HermesJob[]>;
  executionReader?: (
    context: HermesContext,
    manifest: JobsManifest,
    jobIds: readonly string[],
  ) => Promise<Map<string, JobExecutionHistory>>;
}

function resolveContext(options: LoadJobsOptions): HermesContext {
  const environment = options.environment ?? process.env;
  const platformRoot = options.platformRoot
    ?? environment.COCKPIT_PLATFORM_HERMES_ROOT?.trim()
    ?? path.join(homedir(), ".hermes");
  const explicitHome = environment.COCKPIT_HERMES_HOME?.trim();
  return resolveHermesContextFromEnvironment({
    platformRoot,
    environment,
    ...(explicitHome ? { explicitHome } : {}),
  });
}

function resolveJobsManifest(options: LoadJobsOptions): JobsManifest {
  const environment = options.environment ?? process.env;
  const sourceManifest = resolveSourceManifest(environment, options.manifest).manifest;
  if (!sourceManifest.jobs) throw new SourceSecurityError("source_malformed");
  return sourceManifest.jobs;
}

export async function loadJobsPageData(options: LoadJobsOptions = {}): Promise<JobsPageData> {
  const now = options.now ?? new Date();
  const observedAt = now.toISOString();
  const failures: SafeDiagnostic[] = [];
  let context: HermesContext;
  let manifest: JobsManifest;
  try {
    context = resolveContext(options);
    manifest = resolveJobsManifest(options);
  } catch (error) {
    const failure = toSafeDiagnostic(error, "job-definitions", now);
    return {
      jobs: [],
      observedAt,
      definitionsState: sourceStateForCode(failure.code),
      executionsState: "unavailable",
      failures: [failure],
    };
  }

  let jobs: HermesJob[];
  try {
    jobs = await (options.definitionReader ?? readJobDefinitions)(context, manifest);
  } catch (error) {
    const failure = toSafeDiagnostic(error, "job-definitions", now);
    return {
      jobs: [],
      observedAt,
      definitionsState: sourceStateForCode(failure.code),
      executionsState: "unavailable",
      failures: [failure],
    };
  }

  let executionsState: JobsSnapshot["executionsState"] = "ready";
  try {
    const executions = await (options.executionReader ?? readRecentJobExecutions)(
      context,
      manifest,
      jobs.map((job) => job.id),
    );
    jobs = jobs.map((job) => {
      const history = executions.get(job.id);
      return {
        ...job,
        recordedAttempts: history?.recordedAttempts ?? 0,
        executions: history?.executions ?? [],
      };
    });
  } catch (error) {
    const failure = toSafeDiagnostic(error, "job-executions", now);
    failures.push(failure);
    executionsState = sourceStateForCode(failure.code);
  }

  return {
    jobs,
    observedAt,
    definitionsState: "ready",
    executionsState,
    failures,
  };
}

export async function loadJobsSnapshot(options: LoadJobsOptions = {}): Promise<JobsSnapshot> {
  const page = await loadJobsPageData(options);
  return {
    jobs: page.jobs,
    observedAt: page.observedAt,
    definitionsState: page.definitionsState,
    executionsState: page.executionsState,
  };
}
