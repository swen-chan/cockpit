import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { CodexOverviewSnapshot } from "@/contracts/codex";
import { CodexOverviewStatus } from "@/features/overview/codex-overview-status";

const observedAt = "2026-09-16T04:30:00.000Z";

const snapshot: CodexOverviewSnapshot = {
  panelName: "Codex",
  observedAt,
  runtime: {
    state: "ready",
    observedAt,
    label: "Codex CLI",
    version: "0.145.0",
  },
  tasks: {
    state: "ready",
    observedAt: "2026-09-16T04:29:58.000Z",
    items: [
      {
        id: "task-safe-one",
        title: "Implement a bounded Overview",
        preview: "Keep each source independent.",
        source: "CLI",
        lastActivity: "2026-09-16T04:20:00.000Z",
        status: "idle",
        projectLabel: "cockpit",
      },
      {
        id: "task-safe-two",
        title: null,
        preview: null,
        source: "VS Code",
        lastActivity: null,
        status: "unknown",
        projectLabel: null,
      },
    ],
    hasMore: true,
  },
  guidance: {
    state: "ready",
    observedAt: "2026-09-16T04:29:57.000Z",
    items: [
      { label: "Global guidance", state: "ready" },
      { label: "Workspace guidance", state: "missing" },
      { label: "Custom guidance", state: "error" },
    ],
  },
  workspace: {
    state: "ready",
    observedAt: "2026-09-16T04:29:56.000Z",
    loadedCount: 8,
    truncated: true,
    items: [
      {
        name: "AGENTS.md",
        kind: "Markdown",
        size: "2.1 KB",
        modifiedAt: "2026-09-15T03:00:00.000Z",
      },
    ],
  },
};

describe("Codex Overview", () => {
  afterEach(cleanup);

  it("renders the four truthful sections, Project metadata, and scoped links without Jobs", () => {
    render(<CodexOverviewStatus snapshot={snapshot} />);

    expect(screen.getByText("CODEX / READ ONLY")).toBeInTheDocument();
    const register = screen.getByRole("region", { name: "Codex status register" });
    expect(within(register).getByText("0.145.0")).toBeInTheDocument();
    expect(within(register).getByText("2+")).toBeInTheDocument();
    expect(within(register).getByText("1 / 3")).toBeInTheDocument();
    expect(within(register).getByText("8 shown")).toBeInTheDocument();

    const tasks = screen.getByRole("heading", { name: "Tasks" }).closest("section")!;
    expect(within(tasks).getByText("Implement a bounded Overview")).toBeInTheDocument();
    expect(within(tasks).getByText("Untitled task")).toBeInTheDocument();
    expect(within(tasks).getByText("cockpit")).toBeInTheDocument();
    expect(within(tasks).getByText("UNKNOWN")).toBeInTheDocument();
    expect(within(tasks).getAllByText("PROJECT /")).toHaveLength(2);
    expect(within(tasks).getByText("Unknown activity")).toBeInTheDocument();
    expect(within(tasks).getByRole("link", { name: "Tasks" })).toHaveAttribute(
      "href",
      "/agents/codex/conversations",
    );

    const runtime = screen.getByRole("heading", { name: "Runtime" }).closest("section")!;
    expect(within(runtime).getByText("Codex CLI")).toBeInTheDocument();
    expect(within(runtime).getByText("Version 0.145.0")).toBeInTheDocument();

    const guidance = screen.getByRole("heading", { name: "Current guidance" }).closest("section")!;
    expect(within(guidance).getByText("Global guidance")).toBeInTheDocument();
    expect(within(guidance).getByText("Workspace guidance")).toBeInTheDocument();
    expect(within(guidance).getByText("Custom guidance")).toBeInTheDocument();
    expect(within(guidance).getByText("missing")).toBeInTheDocument();
    expect(within(guidance).getByRole("link", { name: "System" })).toHaveAttribute(
      "href",
      "/agents/codex/system",
    );

    const files = screen.getByRole("heading", { name: "Files" }).closest("section")!;
    expect(within(files).getByText("AGENTS.md")).toBeInTheDocument();
    expect(
      within(files).getByText(
        "The approved root listing is partial; counts are not presented as exact.",
      ),
    ).toBeInTheDocument();
    expect(within(files).getByRole("link", { name: "Files" })).toHaveAttribute(
      "href",
      "/agents/codex/files",
    );

    expect(screen.queryByRole("heading", { name: "Jobs" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Jobs" })).not.toBeInTheDocument();
    expect(screen.queryByText(/delivered in Task 9/u)).not.toBeInTheDocument();
    expect(screen.getByText("Current local snapshot")).toBeInTheDocument();
  });

  it("keeps successful sections visible when Tasks and Files fail independently", () => {
    const partial: CodexOverviewSnapshot = {
      ...snapshot,
      tasks: {
        state: "error",
        observedAt: snapshot.tasks.observedAt,
        message: "The local Agent reader returned an invalid response.",
      },
      workspace: {
        state: "unavailable",
        observedAt: snapshot.workspace.observedAt,
        message: "The requested local source is unavailable.",
      },
    };

    render(<CodexOverviewStatus snapshot={partial} />);

    const tasks = screen.getByRole("heading", { name: "Tasks" }).closest("section")!;
    expect(
      within(tasks).getByText("The local Agent reader returned an invalid response."),
    ).toBeInTheDocument();
    expect(within(tasks).getByRole("link", { name: "Tasks" })).toBeInTheDocument();

    const runtime = screen.getByRole("heading", { name: "Runtime" }).closest("section")!;
    expect(within(runtime).getByText("Version 0.145.0")).toBeInTheDocument();

    const guidance = screen.getByRole("heading", { name: "Current guidance" }).closest("section")!;
    expect(within(guidance).getByText("Global guidance")).toBeInTheDocument();

    const files = screen.getByRole("heading", { name: "Files" }).closest("section")!;
    expect(
      within(files).getByText("The requested local source is unavailable."),
    ).toBeInTheDocument();
    expect(within(files).getByRole("link", { name: "Files" })).toHaveAttribute(
      "href",
      "/agents/codex/files",
    );
  });

  it("distinguishes empty sources from unconfigured Files and preserves fallback copy", () => {
    const emptyAndUnsupported: CodexOverviewSnapshot = {
      ...snapshot,
      runtime: {
        state: "unavailable",
        observedAt,
        message: "The selected Agent runtime version is not supported.",
      },
      tasks: {
        state: "ready",
        observedAt,
        items: [],
        hasMore: false,
      },
      guidance: {
        state: "ready",
        observedAt,
        items: [],
      },
      workspace: {
        state: "unsupported",
        observedAt,
        message: "Files not configured",
      },
    };

    render(<CodexOverviewStatus snapshot={emptyAndUnsupported} fallbackFrom="Jobs" />);

    expect(
      screen.getByText("Jobs is not supported by Codex. Opened Overview instead."),
    ).toBeInTheDocument();
    const tasks = screen.getByRole("heading", { name: "Tasks" }).closest("section")!;
    expect(within(tasks).getByText("No indexed Codex Tasks were returned.")).toBeInTheDocument();
    const guidance = screen.getByRole("heading", { name: "Current guidance" }).closest("section")!;
    expect(
      within(guidance).getByText("No current guidance sources were observed."),
    ).toBeInTheDocument();
    const runtime = screen.getByRole("heading", { name: "Runtime" }).closest("section")!;
    expect(
      within(runtime).getByText("The selected Agent runtime version is not supported."),
    ).toBeInTheDocument();
    const files = screen.getByRole("heading", { name: "Files" }).closest("section")!;
    expect(
      within(files).getByRole("heading", { name: "Files not configured" }),
    ).toBeInTheDocument();
    expect(within(files).queryByRole("link", { name: "Files" })).not.toBeInTheDocument();
    expect(within(files).queryByText(/0 files/iu)).not.toBeInTheDocument();
  });
});
