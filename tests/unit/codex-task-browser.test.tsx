import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CodexTaskDetail, CodexTaskPage, CodexTaskSummary } from "@/contracts/codex";
import { CodexTaskBrowser } from "@/features/conversations/codex-task-browser";

const observedAt = "2026-09-16T08:00:00.000Z";

function task(id: string, overrides: Partial<CodexTaskSummary> = {}): CodexTaskSummary {
  return {
    id,
    title: `Task ${id}`,
    preview: `Preview ${id}`,
    source: "CLI",
    lastActivity: observedAt,
    status: "idle",
    projectLabel: "cockpit",
    ...overrides,
  };
}

function page(items: CodexTaskSummary[], nextCursor: string | null = null): CodexTaskPage {
  return {
    items,
    nextCursor,
    observedAt,
    indexScope: "Codex state database",
    inventoryNote: "State-database index; some local tasks may be absent.",
  };
}

function detail(summary: CodexTaskSummary, answer = "Safe final answer"): CodexTaskDetail {
  return {
    summary,
    observedAt,
    omitted: [],
    turns: [
      {
        key: "turn-1",
        status: "completed",
        messages: [
          { key: "message-1", role: "user", content: "Safe user question" },
          { key: "message-2", role: "assistant", content: answer },
        ],
        process: null,
        omitted: [],
      },
    ],
  };
}

function success(data: CodexTaskPage | CodexTaskDetail) {
  return { panelId: "codex", runtime: "codex", data };
}

describe("Codex Task browser", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("starts with list-only state and renders known, unknown, and long Project labels once per row", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/agents/codex/conversations");
    const longLabel = "project-" + "x".repeat(72);
    render(
      <CodexTaskBrowser
        initialPage={page([
          task("task-Known"),
          task("task-Unknown", { projectLabel: null }),
          task("task-Long", { projectLabel: longLabel }),
        ])}
      />,
    );

    expect(screen.getByRole("heading", { name: "Select a task" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    const known = screen.getByRole("button", { name: /Task task-Known/u });
    const unknown = screen.getByRole("button", { name: /Task task-Unknown/u });
    const long = screen.getByRole("button", { name: /Task task-Long/u });
    expect(known).toHaveTextContent("PROJECT / cockpit");
    expect(unknown).toHaveTextContent("PROJECT / UNKNOWN");
    expect(long).toHaveTextContent(`PROJECT / ${longLabel}`);
    expect(within(long).getAllByText(longLabel)).toHaveLength(1);
    expect(long).not.toHaveAttribute("aria-label");
  });

  it("loads only the selected task and ignores a superseded response in the same panel", async () => {
    type MockResponse = { ok: boolean; json: () => Promise<unknown> };
    const first = task("task-First", { title: "First task" });
    const second = task("task-Second", { title: "Second task" });
    const resolvers: Array<(response: MockResponse) => void> = [];
    const fetchMock = vi.fn(() => new Promise<MockResponse>((resolve) => resolvers.push(resolve)));
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/agents/codex/conversations");
    render(<CodexTaskBrowser initialPage={page([first, second])} />);

    fireEvent.click(screen.getByRole("button", { name: /First task/u }));
    fireEvent.click(screen.getByRole("button", { name: /Second task/u }));
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/agents/codex/conversations/task-First",
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/agents/codex/conversations/task-Second",
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
    );

    await act(async () => {
      resolvers[1]!({
        ok: true,
        json: async () => success(detail(second, "Second response wins")),
      });
      await Promise.resolve();
    });
    expect(await screen.findByText("Second response wins")).toBeInTheDocument();

    await act(async () => {
      resolvers[0]!({ ok: true, json: async () => success(detail(first, "Stale first response")) });
      await Promise.resolve();
    });
    expect(screen.queryByText("Stale first response")).not.toBeInTheDocument();
    expect(screen.getByText("Second response wins")).toBeInTheDocument();
  });

  it("keeps Process and nested evidence closed by default and searches only visible safe text", async () => {
    const selected = task("task-Process", { title: "Process task" });
    const processDetail: CodexTaskDetail = {
      summary: selected,
      observedAt,
      omitted: [],
      turns: [
        {
          key: "turn-1",
          status: "completed",
          messages: [
            { key: "message-1", role: "user", content: "Inspect the project" },
            { key: "message-2", role: "assistant", content: "Inspection complete" },
          ],
          omitted: [],
          process: {
            count: 3,
            omitted: [],
            rows: [
              { type: "progress", key: "process-1", text: "VISIBLE_PROGRESS_MARKER" },
              {
                type: "command",
                key: "process-2",
                label: "Command",
                preview: "List files in src",
                status: "completed",
                output: { text: "NESTED_OUTPUT_MARKER", truncated: false },
              },
              {
                type: "changes",
                key: "process-3",
                status: "completed",
                files: [{ path: "src/a.ts", change: "modify" }],
                patch: { text: "NESTED_PATCH_MARKER", truncated: false },
              },
            ],
          },
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => success(processDetail),
      })),
    );
    window.history.replaceState({}, "", "/agents/codex/conversations");
    render(<CodexTaskBrowser initialPage={page([selected])} />);
    await userEvent.click(screen.getByRole("button", { name: /Process task/u }));
    await screen.findByText("Inspection complete");

    const search = screen.getByRole("searchbox", { name: "Search loaded task" });
    await userEvent.type(search, "VISIBLE_PROGRESS_MARKER");
    expect(screen.getByText("0 matches", { selector: ".search-count" })).toBeInTheDocument();

    const process = document.querySelector<HTMLDetailsElement>(".process-disclosure");
    const processSummary = document.querySelector<HTMLElement>(".process-summary");
    expect(process).not.toBeNull();
    expect(process?.open).toBe(false);
    expect(processSummary).toHaveAccessibleName("Process, 3 items");
    expect(processSummary).not.toHaveAttribute("aria-expanded");
    expect(processSummary).toHaveTextContent("PROCESS03");
    process!.open = true;
    fireEvent(process!, new Event("toggle"));
    await waitFor(() =>
      expect(screen.getByText("1 match", { selector: ".search-count" })).toBeInTheDocument(),
    );

    await userEvent.clear(search);
    await userEvent.type(search, "NESTED_OUTPUT_MARKER");
    expect(screen.getByText("0 matches", { selector: ".search-count" })).toBeInTheDocument();
    const output = screen.getByText("Output", { selector: "summary" }).closest("details");
    expect(output).not.toBeNull();
    expect(output).not.toHaveAttribute("open");
    (output as HTMLDetailsElement).open = true;
    fireEvent(output!, new Event("toggle"));
    await waitFor(() =>
      expect(screen.getByText("1 match", { selector: ".search-count" })).toBeInTheDocument(),
    );
    expect(processSummary).toHaveTextContent("03");

    const patch = screen.getByText("Patch", { selector: "summary" }).closest("details");
    expect(patch).not.toBeNull();
    expect(patch).not.toHaveAttribute("open");
  });

  it("appends a bounded second page without sending a client-controlled page size", async () => {
    const initial = Array.from({ length: 5 }, (_, index) => task(`task-Page1_${index + 1}`));
    const older = [
      task("task-Older_1", { projectLabel: null }),
      task("task-Older_2", { projectLabel: "archive-project" }),
    ];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return { ok: true, json: async () => success(page(older)) };
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/agents/codex/conversations");
    render(<CodexTaskBrowser initialPage={page(initial, "cursor-SecondPage")} />);

    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /Task task-/u })).toHaveLength(7),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agents/codex/conversations?cursor=cursor-SecondPage",
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
    );
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain("limit=");
    expect(screen.getByRole("button", { name: /Task task-Older_1/u })).toHaveTextContent(
      "PROJECT / UNKNOWN",
    );
  });

  it("stops offering a rejected cursor and preserves the already loaded index", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({
          panelId: "codex",
          sourceId: "codex-tasks",
          code: "invalid_path",
          message: "The requested relative path is invalid.",
          observedAt,
        }),
      })),
    );
    window.history.replaceState({}, "", "/agents/codex/conversations");
    const initial = Array.from({ length: 5 }, (_, index) => task(`task-Stable_${index + 1}`));
    render(<CodexTaskBrowser initialPage={page(initial, "expired-cursor")} />);

    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(
      await screen.findByText(/The task index changed or its cursor expired/u),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Task task-Stable_/u })).toHaveLength(5);
  });

  it("reports the 25-task bound even when the final source page contains extra items", async () => {
    const pages = new Map<string, CodexTaskPage>([
      [
        "cursor-1",
        page(
          Array.from({ length: 5 }, (_, index) => task(`task-Cap_${index + 6}`)),
          "cursor-2",
        ),
      ],
      [
        "cursor-2",
        page(
          Array.from({ length: 5 }, (_, index) => task(`task-Cap_${index + 11}`)),
          "cursor-3",
        ),
      ],
      [
        "cursor-3",
        page(
          Array.from({ length: 5 }, (_, index) => task(`task-Cap_${index + 16}`)),
          "cursor-4",
        ),
      ],
      [
        "cursor-4",
        page(
          Array.from({ length: 3 }, (_, index) => task(`task-Cap_${index + 21}`)),
          "cursor-5",
        ),
      ],
      ["cursor-5", page(Array.from({ length: 5 }, (_, index) => task(`task-Cap_${index + 24}`)))],
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const cursor = new URL(String(input), "http://localhost").searchParams.get("cursor");
        const nextPage = cursor ? pages.get(cursor) : undefined;
        if (!nextPage) throw new Error("unexpected cursor");
        return { ok: true, json: async () => success(nextPage) };
      }),
    );
    window.history.replaceState({}, "", "/agents/codex/conversations");
    const initial = Array.from({ length: 5 }, (_, index) => task(`task-Cap_${index + 1}`));
    render(<CodexTaskBrowser initialPage={page(initial, "cursor-1")} />);

    for (const count of [10, 15, 20, 23, 25]) {
      await userEvent.click(screen.getByRole("button", { name: "Show more" }));
      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: /Task task-Cap_/u })).toHaveLength(count);
      });
    }

    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
    expect(screen.getByText(/bounded task-index limit has been reached/u)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Task task-Cap_26/u })).not.toBeInTheDocument();
  });
});
