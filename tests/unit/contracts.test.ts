import { describe, expect, it } from "vitest";

import {
  conversationPageSchema,
  conversationSchema,
  jobsSnapshotSchema,
  overviewSnapshotSchema,
  profileSummarySchema,
  sourceStampSchema,
  systemSourceSchema,
  systemSnapshotSchema,
} from "@/contracts/source-result";
import { mockConversations, mockJobs, mockSystemSources } from "@/lib/mock-data";

describe("browser-safe fixture contracts", () => {
  it("accepts the bounded fixture DTOs", () => {
    expect(sourceStampSchema.safeParse(mockSystemSources[0]?.stamp).success).toBe(true);
    expect(conversationSchema.safeParse(mockConversations[0]).success).toBe(true);
    expect(conversationPageSchema.safeParse({
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
      nextCursor: "cursor-opaque",
      observedAt: "2026-09-07T00:00:00.000Z",
    }).success).toBe(true);
    expect(jobsSnapshotSchema.safeParse({
      jobs: mockJobs,
      observedAt: "2026-09-09T00:00:00.000Z",
      definitionsState: "ready",
      executionsState: "ready",
    }).success).toBe(true);
  });

  it("rejects unknown fields rather than silently forwarding them", () => {
    const candidate = { ...mockConversations[0], apiKey: "should-never-cross-boundary" };
    expect(conversationSchema.safeParse(candidate).success).toBe(false);
    expect(jobsSnapshotSchema.safeParse({
      jobs: [{ ...mockJobs[0], prompt: "private" }],
      observedAt: "2026-09-09T00:00:00.000Z",
      definitionsState: "ready",
      executionsState: "ready",
    }).success).toBe(false);
  });

  it("validates strict Task 5 profile and system-source DTOs", () => {
    expect(profileSummarySchema.safeParse({
      profile: "default",
      profileKind: "default",
      homeLabel: "~/.hermes",
      resolutionSource: "platform-default",
      configState: "ready",
      model: "fixture-model",
      provider: "fixture-provider",
    }).success).toBe(true);
    expect(systemSourceSchema.safeParse(mockSystemSources[0]).success).toBe(true);
    expect(systemSnapshotSchema.safeParse({
      profile: {
        profile: "default",
        profileKind: "default",
        homeLabel: "/Users/fixture/.hermes",
        resolutionSource: "platform-default",
        configState: "ready",
        model: "fixture-model",
        provider: "fixture-provider",
      },
      sources: mockSystemSources,
    }).success).toBe(true);
    expect(systemSourceSchema.safeParse({ ...mockSystemSources[0], rawConfig: {} }).success).toBe(false);

    const longHome = `/Users/${"a".repeat(600)}/.hermes`;
    expect(profileSummarySchema.safeParse({
      profile: "custom",
      profileKind: "custom",
      homeLabel: longHome,
      resolutionSource: "explicit",
      configState: "unavailable",
      model: null,
      provider: null,
    }).success).toBe(true);
    expect(systemSourceSchema.safeParse({
      ...mockSystemSources[0],
      metadata: [{ label: "Home", value: longHome }],
    }).success).toBe(true);
  });

  it("keeps the Overview contract compact and rejects nested source content", () => {
    const overview = {
      observedAt: "2026-09-09T03:30:00.000Z",
      profile: {
        state: "ready",
        observedAt: "2026-09-09T03:30:00.000Z",
        profile: "default",
        homeLabel: "/Users/fixture/.hermes",
        configState: "ready",
        model: "fixture-model",
        provider: "fixture-provider",
      },
      conversations: {
        state: "ready",
        observedAt: "2026-09-09T03:30:00.000Z",
        items: [{
          id: "conversation-one",
          title: "Conversation",
          preview: "Bounded preview",
          source: "cli",
          lastActivity: "2026-09-09T03:00:00.000Z",
        }],
        hasMore: false,
      },
      system: { state: "ready", observedAt: "2026-09-09T03:30:00.000Z", items: [] },
      jobs: {
        state: "ready",
        observedAt: "2026-09-09T03:30:00.000Z",
        total: 0,
        enabled: 0,
        paused: 0,
        failedLastRun: 0,
        executionsState: "ready",
        nextEvent: null,
      },
      workspace: {
        state: "ready",
        observedAt: "2026-09-09T03:30:00.000Z",
        loadedCount: 0,
        truncated: false,
        items: [],
      },
    };

    expect(overviewSnapshotSchema.safeParse(overview).success).toBe(true);
    expect(overviewSnapshotSchema.safeParse({
      ...overview,
      system: { ...overview.system, content: "private system body" },
    }).success).toBe(false);
  });
});
