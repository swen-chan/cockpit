import { describe, expect, it } from "vitest";

import type {
  ConversationPage,
  JobsSnapshot,
  ProfileSummary,
  SystemSource,
  WorkspaceDirectory,
} from "@/contracts/cockpit";
import { overviewSnapshotSchema } from "@/contracts/source-result";
import { mockConversations, mockFiles, mockJobs, mockSystemSources } from "@/lib/mock-data";
import { SourceSecurityError } from "@/server/security/errors";
import { loadOverviewSnapshot, type OverviewReaders } from "@/server/services/overview";

const observedAt = "2026-09-09T03:30:00.000Z";
const now = new Date(observedAt);

function profile(): ProfileSummary {
  return {
    profile: "default",
    profileKind: "default",
    homeLabel: "/Users/fixture/.hermes",
    resolutionSource: "platform-default",
    configState: "ready",
    model: "fixture-model",
    provider: "fixture-provider",
    modifiedAt: "2026-09-09T03:00:00.000Z",
  };
}

function conversations(): ConversationPage {
  return {
    items: mockConversations.slice(0, 5).map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      preview: conversation.preview,
      source: conversation.source,
      lastActivity: conversation.lastActivity,
      model: conversation.model,
      messageCount: conversation.messageCount,
      toolCallCount: conversation.toolCallCount,
      profile: conversation.profile,
      workspace: conversation.workspace,
    })),
    nextCursor: "older-page",
    observedAt: "2026-09-09T03:29:58.000Z",
  };
}

function system(): SystemSource[] {
  return ["prompt", "memory", "user", "soul", "agents"].map((id) =>
    mockSystemSources.find((source) => source.id === id)!,
  );
}

function jobs(): JobsSnapshot {
  return {
    jobs: mockJobs,
    observedAt: "2026-09-09T03:29:59.000Z",
    definitionsState: "ready",
    executionsState: "ready",
  };
}

function workspace(): WorkspaceDirectory {
  return {
    path: "",
    parentPath: null,
    items: mockFiles,
    observedAt: "2026-09-09T03:29:57.000Z",
    truncated: true,
  };
}

function readers(overrides: Partial<OverviewReaders> = {}): OverviewReaders {
  return {
    profile: async () => profile(),
    conversations: async () => conversations(),
    system: async () => system(),
    jobs: async () => jobs(),
    workspace: async () => workspace(),
    ...overrides,
  };
}

describe("Overview composition service", () => {
  it("projects only bounded, browser-safe summaries from all five readers", async () => {
    const snapshot = await loadOverviewSnapshot({ now, readers: readers() });

    expect(overviewSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot.conversations.items).toHaveLength(5);
    expect(snapshot.conversations.hasMore).toBe(true);
    expect(snapshot.system.items.map((source) => source.id)).toEqual([
      "agents",
      "soul",
      "memory",
      "user",
      "prompt",
    ]);
    expect(snapshot.workspace.items).toHaveLength(4);
    expect(snapshot.workspace.truncated).toBe(true);
    expect(snapshot.jobs.total).toBe(mockJobs.length);

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("You are Hermes");
    expect(serialized).not.toContain("Repository Instructions");
    expect(serialized).not.toContain('"executions":');
    expect(serialized).not.toContain('"toolsets":');
    expect(serialized).not.toContain('"delivery":');
    expect(serialized).not.toContain('"content":');
  });

  it.each([
    ["profile", "missing_source", "profile", "unavailable"],
    ["conversations", "source_busy", "conversations", "error"],
    ["system", "source_malformed", "system", "error"],
    ["jobs", "missing_source", "jobs", "unavailable"],
    ["workspace", "source_unavailable", "workspace", "error"],
  ] as const)("isolates a %s reader failure", async (readerName, code, sectionName, state) => {
    const snapshot = await loadOverviewSnapshot({
      now,
      readers: readers({
        [readerName]: async () => {
          throw new SourceSecurityError(code);
        },
      }),
    });

    expect(snapshot[sectionName].state).toBe(state);
    for (const sibling of ["profile", "conversations", "system", "jobs", "workspace"] as const) {
      if (sibling !== sectionName) expect(snapshot[sibling].state).toBe("ready");
    }
    expect(snapshot[sectionName].message).toBeTruthy();
  });

  it("preserves successful sections across representative multiple-source failures", async () => {
    const snapshot = await loadOverviewSnapshot({
      now,
      readers: readers({
        conversations: async () => {
          throw new SourceSecurityError("missing_source");
        },
        jobs: async () => ({
          jobs: [],
          observedAt,
          definitionsState: "error",
          executionsState: "unavailable",
        }),
        workspace: async () => {
          throw new SourceSecurityError("source_busy");
        },
      }),
    });

    expect(snapshot.conversations.state).toBe("unavailable");
    expect(snapshot.jobs.state).toBe("error");
    expect(snapshot.jobs.total).toBeNull();
    expect(snapshot.workspace.state).toBe("error");
    expect(snapshot.profile.state).toBe("ready");
    expect(snapshot.system.items).toHaveLength(5);
  });

  it("keeps partial profile, System, and Jobs results visible", async () => {
    const mixedSystem = system().map((source) =>
      source.id === "memory"
        ? { ...source, stamp: { ...source.stamp, state: "unavailable" as const } }
        : source,
    );
    const snapshot = await loadOverviewSnapshot({
      now,
      readers: readers({
        profile: async () => ({ ...profile(), configState: "error", model: null, provider: null }),
        system: async () => mixedSystem,
        jobs: async () => ({ ...jobs(), executionsState: "unavailable" }),
      }),
    });

    expect(snapshot.profile).toMatchObject({
      state: "ready",
      configState: "error",
      profile: "default",
    });
    expect(snapshot.system.state).toBe("ready");
    expect(snapshot.system.items.find((source) => source.id === "memory")?.state).toBe(
      "unavailable",
    );
    expect(snapshot.jobs).toMatchObject({
      state: "ready",
      executionsState: "unavailable",
      total: mockJobs.length,
    });
  });

  it("distinguishes available empty lists from failed sources", async () => {
    const snapshot = await loadOverviewSnapshot({
      now,
      readers: readers({
        conversations: async () => ({ items: [], nextCursor: null, observedAt }),
        jobs: async () => ({
          jobs: [],
          observedAt,
          definitionsState: "ready",
          executionsState: "ready",
        }),
        workspace: async () => ({
          path: "",
          parentPath: null,
          items: [],
          observedAt,
          truncated: false,
        }),
      }),
    });

    expect(snapshot.conversations).toMatchObject({ state: "ready", items: [], hasMore: false });
    expect(snapshot.jobs).toMatchObject({
      state: "ready",
      total: 0,
      enabled: 0,
      paused: 0,
      failedLastRun: 0,
    });
    expect(snapshot.workspace).toMatchObject({ state: "ready", loadedCount: 0, items: [] });
  });

  it("counts running jobs as enabled and ignores invalid next-run timestamps", async () => {
    const base = mockJobs[0]!;
    const snapshot = await loadOverviewSnapshot({
      now,
      readers: readers({
        jobs: async () => ({
          observedAt,
          definitionsState: "ready",
          executionsState: "ready",
          jobs: [
            { ...base, id: "running", name: "Running", state: "running", nextRun: "invalid" },
            {
              ...base,
              id: "later",
              name: "Later",
              state: "enabled",
              nextRun: "2026-09-10T02:00:00Z",
            },
            {
              ...base,
              id: "earlier",
              name: "Earlier",
              state: "enabled",
              nextRun: "2026-09-10T01:00:00Z",
            },
          ],
        }),
      }),
    });

    expect(snapshot.jobs.enabled).toBe(3);
    expect(snapshot.jobs.nextEvent).toEqual({ name: "Earlier", nextRun: "2026-09-10T01:00:00Z" });
  });

  it("sorts invalid workspace timestamps last without failing the section", async () => {
    const valid = mockFiles[0]!;
    const invalid = mockFiles[1]!;
    const snapshot = await loadOverviewSnapshot({
      now,
      readers: readers({
        workspace: async () => ({
          path: "",
          parentPath: null,
          observedAt,
          truncated: false,
          items: [
            { ...invalid, name: "invalid.md", modifiedAt: "not-a-date" },
            { ...valid, name: "valid.md", modifiedAt: "2026-09-09T01:00:00Z" },
          ],
        }),
      }),
    });

    expect(snapshot.workspace.state).toBe("ready");
    expect(snapshot.workspace.items.map((file) => file.name)).toEqual(["valid.md", "invalid.md"]);
  });
});
