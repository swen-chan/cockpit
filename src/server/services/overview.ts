import "server-only";

import type {
  ConversationPage,
  JobsSnapshot,
  OverviewJobs,
  OverviewProfile,
  OverviewSectionStatus,
  OverviewSnapshot,
  OverviewSystem,
  OverviewSystemItem,
  OverviewWorkspace,
  ProfileSummary,
  SystemSource,
  WorkspaceDirectory,
} from "@/contracts/cockpit";
import { sourceStateForCode } from "@/server/adapters/safe-values";
import { toSafeDiagnostic } from "@/server/security/errors";
import { assertSourceReadAllowed } from "@/server/security/prerender-guard";
import { loadConversationPage } from "@/server/services/conversations";
import { loadWorkspaceDirectory } from "@/server/services/files";
import { loadJobsSnapshot } from "@/server/services/jobs";
import { loadCoreSystemSources, loadProfileForRequest } from "@/server/services/system";

const coreSystemSources = [
  { id: "agents", title: "AGENTS.md" },
  { id: "soul", title: "SOUL.md" },
  { id: "memory", title: "Memory" },
  { id: "user", title: "User Profile" },
  { id: "prompt", title: "System Prompt" },
] as const;

export interface OverviewReaders {
  profile: () => Promise<ProfileSummary>;
  conversations: () => Promise<ConversationPage>;
  system: () => Promise<SystemSource[]>;
  jobs: () => Promise<JobsSnapshot>;
  workspace: () => Promise<WorkspaceDirectory>;
}

export interface LoadOverviewOptions {
  now?: Date;
  readers?: Partial<OverviewReaders>;
}

function invoke<T>(reader: () => Promise<T>): Promise<T> {
  return Promise.resolve().then(reader);
}

function failureStatus(error: unknown, sourceId: string, now: Date): OverviewSectionStatus {
  const diagnostic = toSafeDiagnostic(error, sourceId, now);
  return {
    state: sourceStateForCode(diagnostic.code),
    observedAt: diagnostic.observedAt,
    message: diagnostic.message,
  };
}

function profileSection(result: PromiseSettledResult<ProfileSummary>, now: Date): OverviewProfile {
  if (result.status === "rejected") {
    return {
      ...failureStatus(result.reason, "profile", now),
      profile: "Unavailable",
      homeLabel: "<Hermes home unavailable>",
      configState: "unavailable",
      model: null,
      provider: null,
    };
  }

  const profile = result.value;
  const unavailable = profile.profileKind === "unavailable";
  return {
    state: unavailable ? "unavailable" : "ready",
    observedAt: now.toISOString(),
    ...(unavailable ? { message: "The selected Hermes profile is invalid or unavailable." } : {}),
    profile: profile.profile,
    homeLabel: profile.homeLabel,
    configState: profile.configState,
    model: profile.model,
    provider: profile.provider,
    ...(profile.modifiedAt ? { modifiedAt: profile.modifiedAt } : {}),
  };
}

function conversationsSection(
  result: PromiseSettledResult<ConversationPage>,
  now: Date,
): OverviewSnapshot["conversations"] {
  if (result.status === "rejected") {
    return {
      ...failureStatus(result.reason, "conversation-store", now),
      items: [],
      hasMore: false,
    };
  }

  return {
    state: "ready",
    observedAt: result.value.observedAt,
    hasMore: result.value.nextCursor !== null,
    items: result.value.items.slice(0, 5).map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      preview: conversation.preview,
      source: conversation.source,
      lastActivity: conversation.lastActivity,
    })),
  };
}

function systemFreshness(
  source: SystemSource,
): Pick<OverviewSystemItem, "freshnessAt" | "freshnessLabel"> {
  const metadata =
    source.metadata.find((item) => item.label === "Modified") ??
    source.metadata.find((item) => item.label === "Session time");
  return metadata
    ? { freshnessAt: metadata.value, freshnessLabel: metadata.label }
    : { freshnessAt: source.stamp.observedAt, freshnessLabel: "Observed" };
}

function systemSection(result: PromiseSettledResult<SystemSource[]>, now: Date): OverviewSystem {
  if (result.status === "rejected") {
    return {
      ...failureStatus(result.reason, "system-context", now),
      items: [],
    };
  }

  const sources = new Map(result.value.map((source) => [source.id, source]));
  return {
    state: "ready",
    observedAt: now.toISOString(),
    items: coreSystemSources.map((expected) => {
      const source = sources.get(expected.id);
      if (!source) {
        return {
          id: expected.id,
          title: expected.title,
          label: "Core context",
          state: "error",
          observedAt: now.toISOString(),
          freshnessLabel: "Observed",
          freshnessAt: now.toISOString(),
        };
      }
      return {
        id: source.id,
        title: source.title,
        label: source.stamp.label,
        state: source.stamp.state,
        observedAt: source.stamp.observedAt,
        ...systemFreshness(source),
      };
    }),
  };
}

function validTimestamp(value: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function jobsSection(result: PromiseSettledResult<JobsSnapshot>, now: Date): OverviewJobs {
  if (result.status === "rejected") {
    return {
      ...failureStatus(result.reason, "jobs", now),
      total: null,
      enabled: null,
      paused: null,
      failedLastRun: null,
      executionsState: "unavailable",
      nextEvent: null,
    };
  }

  const snapshot = result.value;
  if (snapshot.definitionsState !== "ready") {
    return {
      state: snapshot.definitionsState,
      observedAt: snapshot.observedAt,
      message:
        snapshot.definitionsState === "unavailable"
          ? "Job definitions are unavailable for this profile."
          : "Job definitions could not be safely read.",
      total: null,
      enabled: null,
      paused: null,
      failedLastRun: null,
      executionsState: snapshot.executionsState,
      nextEvent: null,
    };
  }

  const activeJobs = snapshot.jobs.filter(
    (job) => job.state === "enabled" || job.state === "running",
  );
  const nextJob = activeJobs
    .map((job) => ({ job, timestamp: validTimestamp(job.nextRun) }))
    .filter(
      (candidate): candidate is { job: typeof candidate.job; timestamp: number } =>
        candidate.timestamp !== null,
    )
    .sort(
      (left, right) =>
        left.timestamp - right.timestamp || left.job.name.localeCompare(right.job.name),
    )[0]?.job;

  return {
    state: "ready",
    observedAt: snapshot.observedAt,
    total: snapshot.jobs.length,
    enabled: activeJobs.length,
    paused: snapshot.jobs.filter((job) => job.state === "paused").length,
    failedLastRun: snapshot.jobs.filter((job) => job.lastStatus === "failed").length,
    executionsState: snapshot.executionsState,
    nextEvent: nextJob?.nextRun ? { name: nextJob.name, nextRun: nextJob.nextRun } : null,
  };
}

function workspaceSection(
  result: PromiseSettledResult<WorkspaceDirectory>,
  now: Date,
): OverviewWorkspace {
  if (result.status === "rejected") {
    return {
      ...failureStatus(result.reason, "workspace", now),
      loadedCount: null,
      truncated: false,
      items: [],
    };
  }

  const directory = result.value;
  const files = directory.items
    .filter((entry) => entry.entryType === "file")
    .sort((left, right) => {
      const leftTime = validTimestamp(left.modifiedAt) ?? Number.NEGATIVE_INFINITY;
      const rightTime = validTimestamp(right.modifiedAt) ?? Number.NEGATIVE_INFINITY;
      return rightTime - leftTime || left.name.localeCompare(right.name);
    })
    .slice(0, 4)
    .map((entry) => ({
      name: entry.name,
      kind: entry.kind,
      size: entry.size,
      modifiedAt: entry.modifiedAt,
    }));

  return {
    state: "ready",
    observedAt: directory.observedAt,
    loadedCount: directory.items.length,
    truncated: directory.truncated,
    items: files,
  };
}

export async function loadOverviewSnapshot(
  options: LoadOverviewOptions = {},
): Promise<OverviewSnapshot> {
  assertSourceReadAllowed();
  const now = options.now ?? new Date();
  const readers: OverviewReaders = {
    profile: () => loadProfileForRequest(),
    conversations: () => loadConversationPage(null, 5),
    system: () => loadCoreSystemSources(),
    jobs: () => loadJobsSnapshot(),
    workspace: () => loadWorkspaceDirectory(""),
    ...options.readers,
  };

  const [profile, conversations, system, jobs, workspace] = await Promise.allSettled([
    invoke(readers.profile),
    invoke(readers.conversations),
    invoke(readers.system),
    invoke(readers.jobs),
    invoke(readers.workspace),
  ]);

  return {
    observedAt: now.toISOString(),
    profile: profileSection(profile, now),
    conversations: conversationsSection(conversations, now),
    system: systemSection(system, now),
    jobs: jobsSection(jobs, now),
    workspace: workspaceSection(workspace, now),
  };
}
