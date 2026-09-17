import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationBrowser } from "@/features/conversations/conversation-browser";
import { FileBrowser } from "@/features/files/file-browser";
import { JobsBrowser } from "@/features/jobs/jobs-browser";
import { SystemBrowser } from "@/features/system/system-browser";
import { mockConversations, mockFiles, mockJobs, mockSystemSources } from "@/lib/mock-data";

function asConversationSummary(conversation: (typeof mockConversations)[number]) {
  return {
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
  };
}

function stubStackedLayout(matches = true) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

describe("Task 12 usability closure", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("moves keyboard focus into newly selected details only in stacked layouts", () => {
    stubStackedLayout();

    const { unmount } = render(<SystemBrowser sources={mockSystemSources} />);
    fireEvent.click(screen.getByRole("button", { name: /Memory.*Durable context/is }));
    expect(screen.getByRole("heading", { name: "Memory", level: 2 })).toHaveFocus();
    expect(window.matchMedia).toHaveBeenCalledWith("(max-width: 767px)");
    unmount();

    render(<JobsBrowser jobs={mockJobs} />);
    const nextJob = mockJobs[1]!;
    fireEvent.click(screen.getByRole("button", { name: nextJob.name }));
    expect(screen.getByRole("region", { name: `${nextJob.name} details` })).toHaveFocus();
    expect(screen.getByRole("region", { name: "Scheduled jobs table" })).toHaveAttribute(
      "tabindex",
      "0",
    );
  });

  it("does not steal focus from the selected control in the wide layout", () => {
    stubStackedLayout(false);
    render(<SystemBrowser sources={mockSystemSources} />);

    const sourceButton = screen.getByRole("button", { name: /Memory.*Durable context/is });
    sourceButton.focus();
    fireEvent.click(sourceButton);

    expect(sourceButton).toHaveFocus();
    expect(screen.getByRole("heading", { name: "Memory", level: 2 })).not.toHaveFocus();
  });

  it("announces conversation loading and moves focus to the selected transcript", () => {
    stubStackedLayout();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    const page = {
      items: mockConversations.slice(0, 2).map(asConversationSummary),
      nextCursor: "cursor-fixture",
      observedAt: "2026-09-07T00:00:00.000Z",
    };
    render(<ConversationBrowser initialPage={page} initialConversation={mockConversations[0]!} />);

    const paginationNote = screen.getByText(
      "2 sessions loaded. Load older eligible sessions as needed.",
    );
    expect(paginationNote).toHaveAttribute("role", "status");
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(mockConversations[1]!.title, "i") }),
    );

    const title = screen.getByRole("heading", { name: mockConversations[1]!.title });
    expect(title).toHaveFocus();
    expect(title.closest("article")).toHaveAttribute("aria-busy", "true");
  });

  it("exposes load-more progress without replacing the loaded conversation list", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    render(
      <ConversationBrowser
        initialPage={{
          items: mockConversations.slice(0, 2).map(asConversationSummary),
          nextCursor: "cursor-fixture",
          observedAt: "2026-09-07T00:00:00.000Z",
        }}
        initialConversation={mockConversations[0]!}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));

    expect(screen.getByRole("region", { name: "Eligible conversations" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByRole("button", { name: "Loading…" })).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByRole("button", { name: new RegExp(mockConversations[0]!.title, "i") }),
    ).toBeInTheDocument();
  });

  it("moves focus to the final pagination status when Show more is removed", async () => {
    const nextConversation = asConversationSummary(mockConversations[2]!);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [nextConversation],
          nextCursor: null,
          observedAt: "2026-09-07T00:00:00.000Z",
        }),
      }),
    );
    render(
      <ConversationBrowser
        initialPage={{
          items: mockConversations.slice(0, 2).map(asConversationSummary),
          nextCursor: "cursor-fixture",
          observedAt: "2026-09-07T00:00:00.000Z",
        }}
        initialConversation={mockConversations[0]!}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));

    const status = await screen.findByText("All 3 eligible sessions are loaded.");
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
    await waitFor(() => expect(status).toHaveFocus());
  });

  it("keeps the current preview while directory navigation is pending", () => {
    const directoryEntry = {
      id: "docs",
      name: "docs",
      path: "docs",
      entryType: "directory" as const,
      kind: "Directory",
      size: "—",
      sizeBytes: null,
      modifiedAt: "2026-09-08T00:00:00.000Z",
      previewState: "unavailable" as const,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    render(
      <FileBrowser
        initialDirectory={{
          path: "",
          parentPath: null,
          items: [directoryEntry],
          observedAt: "2026-09-08T00:00:00.000Z",
          truncated: false,
        }}
        initialFile={mockFiles[0]!}
      />,
    );

    const directoryButton = screen.getByRole("button", { name: /docs.*Directory/is });
    directoryButton.focus();
    fireEvent.click(directoryButton);

    expect(screen.getByRole("region", { name: "Workspace files" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(directoryButton).toHaveFocus();
    expect(screen.getByRole("heading", { name: mockFiles[0]!.name })).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search this file" })).toBeInTheDocument();
    expect(screen.getByText(/When starting a local server/i)).toBeInTheDocument();
  });

  it("shows an initial root failure only in the directory pane", () => {
    render(
      <FileBrowser
        initialDirectory={{
          path: "",
          parentPath: null,
          items: [],
          observedAt: "2026-09-08T00:00:00.000Z",
          truncated: false,
        }}
        initialDirectoryFailure="The requested local source is unavailable."
        initialFile={null}
      />,
    );

    const directoryPane = screen.getByRole("region", { name: "Workspace files" });
    const previewPane = screen.getByRole("article", { name: "Select a file" });
    expect(directoryPane).toHaveTextContent("The requested local source is unavailable.");
    expect(previewPane).toHaveTextContent(
      "Choose a file or open a directory from the approved workspace.",
    );
    expect(previewPane).not.toHaveTextContent("The requested local source is unavailable.");
    const metadata = screen.getByRole("complementary", { name: "File metadata" });
    expect(metadata).toHaveTextContent("Load failed");
    expect(metadata).not.toHaveTextContent(/Entries\s*0/);
  });

  it("keeps metadata for the last usable directory when navigation fails", async () => {
    const directoryEntry = {
      id: "docs",
      name: "docs",
      path: "docs",
      entryType: "directory" as const,
      kind: "Directory",
      size: "—",
      sizeBytes: null,
      modifiedAt: "2026-09-08T00:00:00.000Z",
      previewState: "unavailable" as const,
    };
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("synthetic failure")));
    render(
      <FileBrowser
        initialDirectory={{
          path: "",
          parentPath: null,
          items: [directoryEntry, mockFiles[0]!],
          observedAt: "2026-09-08T00:00:00.000Z",
          truncated: false,
        }}
        initialFile={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /docs.*Directory/is }));

    expect(
      await screen.findByText("The selected directory could not be safely loaded."),
    ).toBeInTheDocument();
    const metadata = screen.getByRole("complementary", { name: "File metadata" });
    expect(metadata).toHaveTextContent(/Entries\s*2/);
    expect(metadata).not.toHaveTextContent("Load failed");
  });

  it("keeps the initial directory usable when only its first preview fails", () => {
    render(
      <FileBrowser
        initialDirectory={{
          path: "",
          parentPath: null,
          items: [mockFiles[0]!],
          observedAt: "2026-09-08T00:00:00.000Z",
          truncated: false,
        }}
        initialFile={mockFiles[0]!}
        initialPreviewFailure="The requested local source is unavailable."
      />,
    );

    const directoryPane = screen.getByRole("region", { name: "Workspace files" });
    const previewPane = screen.getByRole("article", { name: mockFiles[0]!.name });
    expect(directoryPane).toContainElement(
      screen.getByRole("button", { name: new RegExp(mockFiles[0]!.name, "i") }),
    );
    expect(directoryPane).not.toHaveTextContent("The requested local source is unavailable.");
    expect(previewPane).toHaveTextContent("The requested local source is unavailable.");
    const metadata = screen.getByRole("complementary", { name: "File metadata" });
    expect(metadata).toHaveTextContent("Load failed");
    expect(metadata).not.toHaveTextContent("available");
  });

  it("lets a file selection cancel pending directory navigation", async () => {
    const directoryEntry = {
      id: "docs",
      name: "docs",
      path: "docs",
      entryType: "directory" as const,
      kind: "Directory",
      size: "—",
      sizeBytes: null,
      modifiedAt: "2026-09-08T00:00:00.000Z",
      previewState: "unavailable" as const,
    };
    const nestedFile = {
      id: "docs/guide.md",
      name: "guide.md",
      path: "docs/guide.md",
      entryType: "file" as const,
      kind: "Markdown",
      size: "40 B",
      sizeBytes: 40,
      modifiedAt: "2026-09-08T00:00:00.000Z",
      previewState: "available" as const,
    };
    type MockResponse = { ok: boolean; json: () => Promise<unknown> };
    let resolveDirectory!: (response: MockResponse) => void;
    let resolveFile!: (response: MockResponse) => void;
    const fetchMock = vi.fn().mockImplementation((input: string) => {
      if (input.startsWith("/api/files?")) {
        return new Promise<MockResponse>((resolve) => {
          resolveDirectory = resolve;
        });
      }
      return new Promise<MockResponse>((resolve) => {
        resolveFile = resolve;
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <FileBrowser
        initialDirectory={{
          path: "",
          parentPath: null,
          items: [directoryEntry, mockFiles[0]!],
          observedAt: "2026-09-08T00:00:00.000Z",
          truncated: false,
        }}
        initialFile={mockFiles[0]!}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /docs.*Directory/is }));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(mockFiles[0]!.name, "i") }));
    const directoryRequest = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(directoryRequest?.signal?.aborted).toBe(true);

    await act(async () => {
      resolveDirectory({
        ok: true,
        json: async () => ({
          path: "docs",
          parentPath: "",
          items: [nestedFile],
          observedAt: "2026-09-08T00:00:00.000Z",
          truncated: false,
        }),
      });
    });
    await act(async () => {
      resolveFile({
        ok: true,
        json: async () => ({ ...mockFiles[0]!, content: "Latest file preview." }),
      });
    });

    expect(screen.getByLabelText("Current workspace directory root")).toBeInTheDocument();
    expect(screen.queryByLabelText("Current workspace directory docs")).not.toBeInTheDocument();
    expect(await screen.findByText("Latest file preview.")).toBeInTheDocument();
  });

  it("focuses the stable root after a directory loads", async () => {
    const directoryEntry = {
      id: "docs",
      name: "docs",
      path: "docs",
      entryType: "directory" as const,
      kind: "Directory",
      size: "—",
      sizeBytes: null,
      modifiedAt: "2026-09-08T00:00:00.000Z",
      previewState: "unavailable" as const,
    };
    const nestedFile = {
      id: "docs/AGENTS.md",
      name: "AGENTS.md",
      path: "docs/AGENTS.md",
      entryType: "file" as const,
      kind: "Markdown",
      size: "6.4 KB",
      sizeBytes: 6_554,
      modifiedAt: "2026-09-08T00:00:00.000Z",
      previewState: "available" as const,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          path: "docs",
          parentPath: "",
          items: [nestedFile],
          observedAt: "2026-09-08T00:00:00.000Z",
          truncated: false,
        }),
      }),
    );
    render(
      <FileBrowser
        initialDirectory={{
          path: "",
          parentPath: null,
          items: [directoryEntry],
          observedAt: "2026-09-08T00:00:00.000Z",
          truncated: false,
        }}
        initialFile={mockFiles[0]!}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /docs.*Directory/is }));

    const directoryRoot = await screen.findByLabelText("Current workspace directory docs");
    await waitFor(() => expect(directoryRoot).toHaveFocus());
    expect(screen.getByRole("button", { name: /AGENTS\.md.*Markdown/is })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Select a file" })).toBeInTheDocument();
  });

  it("moves focus to a selected file preview and makes long text keyboard-scrollable", async () => {
    stubStackedLayout();
    const textFile = { ...mockFiles[0]!, kind: "Text", content: "Bounded text preview." };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => textFile }));
    render(
      <FileBrowser
        initialDirectory={{
          path: "",
          parentPath: null,
          items: [textFile],
          observedAt: "2026-09-08T00:00:00.000Z",
          truncated: false,
        }}
        initialFile={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: new RegExp(textFile.name, "i") }));

    expect(screen.getByRole("heading", { name: textFile.name })).toHaveFocus();
    expect(await screen.findByRole("region", { name: `${textFile.name} preview` })).toHaveAttribute(
      "tabindex",
      "0",
    );
  });

  it("formats known System timestamps and uses production-safe bounded copy", () => {
    const source = {
      ...mockSystemSources.find((item) => item.id === "memory")!,
      stamp: {
        ...mockSystemSources.find((item) => item.id === "memory")!.stamp,
        truncated: true,
      },
      metadata: [{ label: "Modified", value: "2026-08-22T07:51:00.000Z", mono: true }],
    };
    render(<SystemBrowser sources={[source]} />);

    expect(screen.getByText("2026-08-22 15:51 CST")).toBeInTheDocument();
    expect(
      screen.getByText("Preview is bounded. Additional source content is not shown."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/fixture/i)).not.toBeInTheDocument();
  });
});
