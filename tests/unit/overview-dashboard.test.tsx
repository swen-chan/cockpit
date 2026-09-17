import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { OverviewSnapshot } from "@/contracts/cockpit";
import { OverviewDashboard } from "@/features/overview/overview-dashboard";

const snapshot: OverviewSnapshot = {
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
    observedAt: "2026-09-09T03:29:58.000Z",
    items: [
      {
        id: "conversation-one",
        title: "Live conversation",
        preview: "A bounded summary from the real adapter.",
        source: "telegram",
        lastActivity: "2026-09-09T03:15:00.000Z",
      },
    ],
    hasMore: true,
  },
  system: {
    state: "ready",
    observedAt: "2026-09-09T03:29:57.000Z",
    items: [
      {
        id: "agents",
        title: "AGENTS.md",
        label: "Approved workspace",
        state: "ready",
        observedAt: "2026-09-09T03:29:57.000Z",
        freshnessLabel: "Modified",
        freshnessAt: "2026-09-08T03:00:00.000Z",
      },
    ],
  },
  jobs: {
    state: "ready",
    observedAt: "2026-09-09T03:29:59.000Z",
    total: 8,
    enabled: 6,
    paused: 1,
    failedLastRun: 2,
    executionsState: "unavailable",
    nextEvent: { name: "Daily report", nextRun: "2026-09-09T06:00:00.000Z" },
  },
  workspace: {
    state: "ready",
    observedAt: "2026-09-09T03:29:56.000Z",
    loadedCount: 12,
    truncated: true,
    items: [
      {
        name: "AGENTS.md",
        kind: "Markdown",
        size: "6.4 KB",
        modifiedAt: "2026-09-08T03:00:00.000Z",
      },
    ],
  },
};

describe("Overview dashboard", () => {
  afterEach(cleanup);

  it("renders the live compact registers and their independent freshness", () => {
    render(<OverviewDashboard snapshot={snapshot} />);

    expect(screen.getByText("LIVE / READ ONLY")).toBeInTheDocument();
    expect(screen.getByText("/Users/fixture/.hermes")).toBeInTheDocument();
    expect(screen.getByText("fixture-model")).toBeInTheDocument();
    expect(screen.getByText("1+")).toBeInTheDocument();
    expect(screen.getByText("8 total · 1 paused")).toBeInTheDocument();
    expect(screen.getByText("Approved workspace · 12 shown / partial")).toBeInTheDocument();
    expect(screen.getByText("Live conversation")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Conversations" })).toHaveAttribute(
      "href",
      "/conversations",
    );
    expect(screen.getByRole("link", { name: "System" })).toHaveAttribute("href", "/system");
    expect(screen.getByRole("link", { name: "Jobs" })).toHaveAttribute("href", "/jobs");
    expect(screen.getByRole("link", { name: "Files" })).toHaveAttribute("href", "/files");
    expect(screen.queryByRole("link", { name: /Live conversation/i })).not.toBeInTheDocument();
    expect(
      screen.getByText("Approved workspace · Modified 2026-09-08 11:00 CST"),
    ).toBeInTheDocument();
    expect(screen.getByText("History partial")).toBeInTheDocument();
    expect(screen.getByText("Daily report")).toBeInTheDocument();
    expect(screen.getByText("Live local snapshot")).toBeInTheDocument();
    expect(screen.queryByText("Mock UI milestone")).not.toBeInTheDocument();
  });

  it("keeps Overview links inside a validated scoped panel", () => {
    render(<OverviewDashboard snapshot={snapshot} basePath="/agents/hermes" />);

    expect(screen.getByRole("link", { name: "Conversations" })).toHaveAttribute(
      "href",
      "/agents/hermes/conversations",
    );
    expect(screen.getByRole("link", { name: "System" })).toHaveAttribute(
      "href",
      "/agents/hermes/system",
    );
    expect(screen.getByRole("link", { name: "Jobs" })).toHaveAttribute(
      "href",
      "/agents/hermes/jobs",
    );
    expect(screen.getByRole("link", { name: "Files" })).toHaveAttribute(
      "href",
      "/agents/hermes/files",
    );
  });

  it("keeps successful sections visible while failures and empty data stay scoped", () => {
    const partial: OverviewSnapshot = {
      ...snapshot,
      profile: { ...snapshot.profile, configState: "error", model: null, provider: null },
      conversations: {
        ...snapshot.conversations,
        state: "unavailable",
        message: "Conversation source unavailable.",
        items: [],
        hasMore: false,
      },
      system: {
        ...snapshot.system,
        items: [{ ...snapshot.system.items[0]!, state: "error" }],
      },
      jobs: {
        ...snapshot.jobs,
        state: "error",
        message: "Job definitions could not be safely read.",
        total: null,
        enabled: null,
        paused: null,
        failedLastRun: null,
        nextEvent: null,
      },
      workspace: { ...snapshot.workspace, loadedCount: 0, truncated: false, items: [] },
    };

    render(<OverviewDashboard snapshot={partial} />);

    const conversations = screen
      .getByRole("heading", { name: "Conversations" })
      .closest("section")!;
    const system = screen.getByRole("heading", { name: "System" }).closest("section")!;
    const jobs = screen.getByRole("heading", { name: "Jobs" }).closest("section")!;
    const workspace = screen.getByRole("heading", { name: "Files" }).closest("section")!;

    expect(within(conversations).getByText("Conversation source unavailable.")).toBeInTheDocument();
    expect(within(system).getByText("AGENTS.md")).toBeInTheDocument();
    expect(within(system).getByText("error")).toBeInTheDocument();
    expect(within(jobs).getByText("Job definitions could not be safely read.")).toBeInTheDocument();
    expect(
      within(workspace).getByText("The workspace root contains no visible entries."),
    ).toBeInTheDocument();
    expect(within(conversations).getByRole("link", { name: "Conversations" })).toHaveAttribute(
      "href",
      "/conversations",
    );
    expect(within(system).getByRole("link", { name: "System" })).toHaveAttribute("href", "/system");
    expect(within(jobs).getByRole("link", { name: "Jobs" })).toHaveAttribute("href", "/jobs");
    expect(within(workspace).getByRole("link", { name: "Files" })).toHaveAttribute(
      "href",
      "/files",
    );
    expect(screen.getByText("default")).toBeInTheDocument();
    expect(screen.getByText("Config read failed")).toBeInTheDocument();
  });
});
