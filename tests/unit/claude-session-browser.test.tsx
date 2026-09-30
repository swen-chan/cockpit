import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ClaudeSessionBrowser } from "@/components/claude-session-browser";
import type { ClaudeSessionDetail, ClaudeSessionPage } from "@/contracts/claude";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

it("keeps pure tool positions and missing context separate from a compaction summary", async () => {
  const observedAt = "2026-09-28T08:00:00.000Z";
  const initialPage: ClaudeSessionPage = {
    items: [
      {
        id: "task-Bounded",
        title: "Bounded session",
        preview: null,
        directoryName: null,
        gitBranch: null,
        updatedAt: observedAt,
        issue: null,
      },
    ],
    nextCursor: null,
    observedAt,
    scope: "Configured Claude Code session directory",
    limited: false,
  };
  const detail: ClaudeSessionDetail = {
    id: "task-Bounded",
    title: "Bounded session",
    directoryName: null,
    gitBranch: null,
    messages: [
      { key: "message-1", role: "summary", content: "Earlier saved context", timestamp: null },
      { key: "message-2", role: "assistant", content: null, timestamp: null },
      { key: "message-3", role: "assistant", content: "Latest saved answer", timestamp: null },
    ],
    activities: [
      {
        key: "activity-1",
        messageKey: null,
        category: "Command",
        state: "recorded_error",
        label: "Command",
        filePath: null,
        command: null,
        result: null,
      },
      {
        key: "activity-2",
        messageKey: "message-2",
        category: "Read",
        state: "no_result_recorded",
        label: "Read file",
        filePath: null,
        command: null,
        result: null,
      },
    ],
    observedAt,
    updatedAt: observedAt,
    limited: true,
    pendingWrite: true,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ panelId: "claude-code", runtime: "claude-code", data: detail }),
    })),
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
  window.history.replaceState({}, "", "/agents/claude-code/conversations?project=atlas");
  const { container } = render(
    <ClaudeSessionBrowser initialPage={initialPage} projectId="atlas" />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Bounded session/u }));
  expect(await screen.findByText("Latest saved answer")).toBeVisible();
  const messages = container.querySelectorAll(".message");
  expect(messages).toHaveLength(3);
  expect(messages[0]).toHaveTextContent("Latest saved answer");
  expect(messages[1]).toHaveTextContent("Tool activity");
  expect(messages[1]).toHaveTextContent("Read");
  expect(messages[1]).not.toHaveTextContent("Command");
  expect(messages[2]).toHaveTextContent("Compaction summary");
  expect(messages[2]!.querySelector("details")).toBeNull();
  const unassigned = screen.getByRole("heading", { name: "Context not displayed" }).parentElement!;
  expect(unassigned).toHaveTextContent("Command");
  expect(within(unassigned).getByText("Recorded error / 1")).toBeVisible();
  expect(container.querySelectorAll("details[open]")).toHaveLength(0);
  expect(screen.getByText(/Display limit reached/u)).toBeVisible();
  expect(screen.getByText(/unfinished record/u)).toBeVisible();
});

it("loads only a selected session and keeps a superseded response out of the conversation", async () => {
  const observedAt = "2026-09-28T08:00:00.000Z";
  const initialPage: ClaudeSessionPage = {
    items: [
      {
        id: "task-First",
        title: "First session",
        preview: null,
        directoryName: null,
        gitBranch: null,
        updatedAt: observedAt,
        issue: null,
      },
      {
        id: "task-Second",
        title: "Second session",
        preview: null,
        directoryName: null,
        gitBranch: null,
        updatedAt: observedAt,
        issue: null,
      },
    ],
    nextCursor: null,
    observedAt,
    scope: "Configured Claude Code session directory",
    limited: false,
  };
  type MockResponse = { ok: boolean; json: () => Promise<unknown> };
  const responses: Array<(response: MockResponse) => void> = [];
  const fetchMock = vi.fn(() => new Promise<MockResponse>((resolve) => responses.push(resolve)));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
  window.history.replaceState({}, "", "/agents/claude-code/conversations?project=atlas");
  render(<ClaudeSessionBrowser initialPage={initialPage} projectId="atlas" />);
  expect(screen.getByRole("heading", { name: "Select a session" })).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: /First session/u }));
  fireEvent.click(screen.getByRole("button", { name: /Second session/u }));
  expect(fetchMock).toHaveBeenNthCalledWith(
    2,
    "/api/agents/claude-code/conversations/task-Second?project=atlas",
    expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
  );
  const detail = (id: string, content: string): ClaudeSessionDetail => ({
    id,
    title: null,
    messages: [{ key: "message-1", role: "assistant", content, timestamp: null }],
    activities: [],
    observedAt,
    updatedAt: observedAt,
    limited: false,
    pendingWrite: false,
    directoryName: null,
    gitBranch: null,
  });
  const success = (data: ClaudeSessionDetail): MockResponse => ({
    ok: true,
    json: async () => ({ panelId: "claude-code", runtime: "claude-code", data }),
  });
  await act(async () => responses[1]!(success(detail("task-Second", "Second answer"))));
  expect(await screen.findByText("Second answer")).toBeInTheDocument();

  await act(async () => responses[0]!(success(detail("task-First", "Stale first answer"))));
  expect(screen.queryByText("Stale first answer")).not.toBeInTheDocument();
  expect(screen.getByText("Second answer")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Second session" })).toBeInTheDocument();
});

it("searches loaded titles, previews, recorded directory names and branches without detail reads", async () => {
  const observedAt = "2026-09-28T08:00:00.000Z";
  const initialPage: ClaudeSessionPage = {
    items: [
      {
        id: "task-First",
        title: "Investigate deployment",
        preview: "Region mismatch",
        directoryName: "shared-directory",
        gitBranch: "fix/region",
        updatedAt: observedAt,
        issue: null,
      },
      {
        id: "task-Second",
        title: "Review changes",
        preview: "No signal",
        directoryName: "shared-directory",
        gitBranch: "review/release",
        updatedAt: observedAt,
        issue: null,
      },
    ],
    nextCursor: "cursor-Older",
    observedAt,
    scope: "Configured Claude Code session directory",
    limited: false,
  };
  const nextPage: ClaudeSessionPage = {
    ...initialPage,
    items: [
      {
        id: "task-Older",
        title: "Older investigation",
        preview: null,
        directoryName: null,
        gitBranch: null,
        updatedAt: observedAt,
        issue: null,
      },
    ],
    nextCursor: null,
  };
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ panelId: "claude-code", runtime: "claude-code", data: nextPage }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/agents/claude-code/conversations?project=atlas");
  render(<ClaudeSessionBrowser initialPage={initialPage} projectId="atlas" />);
  const search = screen.getByRole("searchbox", { name: "Search loaded sessions" });

  fireEvent.change(search, { target: { value: "REGION" } });
  expect(screen.getByRole("button", { name: /Investigate deployment/u })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Review changes/u })).not.toBeInTheDocument();
  expect(screen.getByText("1 match", { selector: ".search-count" })).toBeInTheDocument();
  fireEvent.change(search, { target: { value: "SHARED-DIRECTORY" } });
  expect(screen.getByRole("button", { name: /Investigate deployment/u })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Review changes/u })).toBeInTheDocument();
  fireEvent.change(search, { target: { value: "REVIEW/RELEASE" } });
  expect(screen.getByRole("button", { name: /Review changes/u })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Investigate deployment/u })).not.toBeInTheDocument();
  fireEvent.change(search, { target: { value: "2026" } });
  expect(screen.getByRole("heading", { name: "No matching sessions" })).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();

  fireEvent.change(search, { target: { value: "Older" } });
  expect(screen.getByRole("heading", { name: "No matching sessions" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show more" }));
  expect(await screen.findByRole("button", { name: /Older investigation/u })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Investigate deployment/u })).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
    "/api/agents/claude-code/conversations?cursor=cursor-Older&project=atlas",
    expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
  );
  expect(screen.getByRole("heading", { name: "Select a session" })).toBeInTheDocument();
  fireEvent.change(search, { target: { value: "" } });
  expect(screen.getByRole("button", { name: /Investigate deployment/u })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Review changes/u })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Older investigation/u })).toBeInTheDocument();
});

it.each([false, true])(
  "shows concrete operations with folded inert output; returning to a message: %s",
  (returnToMessage) => {
    const observedAt = "2026-09-28T08:00:00.000Z";
    const initialPage: ClaudeSessionPage = {
      items: [],
      nextCursor: null,
      observedAt,
      scope: "Configured Claude Code session directory",
      limited: false,
    };
    const initialDetail: ClaudeSessionDetail = {
      id: "task-Review",
      title: "Review settings changes",
      directoryName: "atlas",
      gitBranch: "fix/settings",
      messages: [
        { key: "message-1", role: "assistant", content: "Check the saved work.", timestamp: null },
      ],
      activities: [
        {
          key: "activity-1",
          messageKey: "message-1",
          category: "Edit",
          label: "Edit src/settings.ts",
          filePath: "src/settings.ts",
          command: null,
          state: "result_recorded",
          result: { text: "Recorded edit applied.", truncated: false },
        },
        {
          key: "activity-2",
          messageKey: "message-1",
          category: "Command",
          label: "Recorded command",
          filePath: null,
          command: "pnpm test",
          state: "result_recorded",
          result: {
            text: "Tests 12 passed. <script>window.syntheticProbe = true</script>",
            truncated: true,
          },
        },
      ],
      observedAt,
      updatedAt: observedAt,
      limited: false,
      pendingWrite: false,
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(
      {},
      "",
      `/agents/claude-code/conversations?project=atlas&session=task-Review${returnToMessage ? "#message-1" : ""}`,
    );
    const { container } = render(
      <ClaudeSessionBrowser
        initialPage={initialPage}
        projectId="atlas"
        initialDetail={initialDetail}
        initialSessionId="task-Review"
      />,
    );
    expect(screen.getByRole("heading", { name: "Review settings changes" })).toBeInTheDocument();
    expect(screen.getByText("Check the saved work.")).toBeVisible();
    expect(screen.getByText("Edit src/settings.ts")).toBeInTheDocument();
    expect(screen.getByText("pnpm test")).toBeInTheDocument();
    expect(container.querySelectorAll("details[open]")).toHaveLength(returnToMessage ? 1 : 0);
    const owningMessage = container.querySelector("#message-1")!;
    const owningActivity = owningMessage.querySelector(".claude-activity-disclosure")!;
    if (returnToMessage) {
      expect(owningMessage).toHaveFocus();
      expect(owningActivity).toHaveAttribute("open");
    } else {
      expect(owningMessage).not.toHaveFocus();
      expect(owningActivity).not.toHaveAttribute("open");
    }
    const file = screen.getByRole("link", { name: "Open file", hidden: true });
    const href = new URL(file.getAttribute("href")!, "http://cockpit.invalid");
    expect(href.pathname).toBe("/agents/claude-code/files");
    expect(Object.fromEntries(href.searchParams)).toEqual({
      project: "atlas",
      path: "src/settings.ts",
      session: "task-Review",
      message: "message-1",
    });
    const recorded = screen.getByText(
      "Tests 12 passed. <script>window.syntheticProbe = true</script>",
    );
    expect(recorded.closest("details")).not.toHaveAttribute("open");
    expect(recorded).not.toBeVisible();
    expect(container.querySelector("script")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

it("does not offer file navigation for unlinked tool records", () => {
  const observedAt = "2026-09-28T08:00:00.000Z";
  const initialPage: ClaudeSessionPage = {
    items: [],
    nextCursor: null,
    observedAt,
    scope: "Configured Claude Code session directory",
    limited: false,
  };
  const initialDetail: ClaudeSessionDetail = {
    id: "task-Review",
    title: "Missing target",
    directoryName: null,
    gitBranch: null,
    messages: [{ key: "message-1", role: "assistant", content: null, timestamp: null }],
    activities: [
      {
        key: "activity-1",
        messageKey: "message-1",
        category: "Read",
        label: "Read file",
        filePath: null,
        command: null,
        result: null,
        state: "recorded_error",
      },
    ],
    observedAt,
    updatedAt: observedAt,
    limited: false,
    pendingWrite: false,
  };
  window.history.replaceState({}, "", "/agents/claude-code/conversations?project=atlas");
  render(
    <ClaudeSessionBrowser
      initialPage={initialPage}
      projectId="atlas"
      initialDetail={initialDetail}
      initialSessionId="task-Review"
    />,
  );
  expect(screen.queryByRole("link", { name: "Open file", hidden: true })).not.toBeInTheDocument();
  expect(screen.getByText("Recorded error / 1")).toBeVisible();
});
