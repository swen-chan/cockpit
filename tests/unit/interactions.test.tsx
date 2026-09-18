import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationBrowser } from "@/features/conversations/conversation-browser";
import { FileBrowser } from "@/features/files/file-browser";
import { JobsBrowser } from "@/features/jobs/jobs-browser";
import { SystemBrowser } from "@/features/system/system-browser";
import { mockConversations, mockFiles, mockJobs, mockSystemSources } from "@/lib/mock-data";

const mockDirectory = {
  path: "",
  parentPath: null,
  items: mockFiles,
  observedAt: "2026-09-08T00:00:00.000Z",
  truncated: false,
};

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

describe("mock inspection flows", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("selects a system source and searches its loaded preview", () => {
    render(<SystemBrowser sources={mockSystemSources} />);
    fireEvent.click(screen.getByRole("button", { name: /Memory.*Durable context/is }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search this document" }), {
      target: { value: "source" },
    });
    expect(screen.getByRole("status")).toHaveTextContent("2 matches");
    expect(screen.getAllByText("source", { selector: "mark" })).toHaveLength(2);
  });

  it("filters loaded skill metadata without loading skill bodies", () => {
    render(<SystemBrowser sources={mockSystemSources} />);
    fireEvent.click(screen.getByRole("button", { name: /Skills.*Capabilities/is }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Filter skills" }), {
      target: { value: "research" },
    });
    expect(screen.getByText("1 match", { selector: ".search-count" })).toBeInTheDocument();
    expect(screen.getByText("research-brief")).toBeInTheDocument();
    expect(screen.queryByText("document-export")).not.toBeInTheDocument();
  });

  it("loads a selected skill body through its opaque id", async () => {
    const skill = mockSystemSources.find((source) => source.id === "skills")?.collection?.items[0];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: skill?.id,
          title: skill?.name,
          category: skill?.category,
          summary: skill?.description,
          content: "# Loaded skill\n\nBounded instructions.",
          stamp: {
            id: skill?.id,
            label: "Hermes skill manifest",
            path: `<HERMES_HOME> / skills / ${skill?.path}`,
            observedAt: "2026-09-04T00:00:00.000Z",
            state: "ready",
          },
          metadata: [{ label: "Type", value: "SKILL.md" }],
        }),
      }),
    );

    render(<SystemBrowser sources={mockSystemSources} />);
    fireEvent.click(screen.getByRole("button", { name: /Skills.*Capabilities/is }));
    const skillButton = screen.getByRole("button", { name: /research-brief/i });
    skillButton.focus();
    fireEvent.click(skillButton);

    expect(
      await screen.findByRole("heading", { name: "research-brief instructions" }),
    ).toBeInTheDocument();
    expect(screen.getByText("document-export")).toBeInTheDocument();
    expect(screen.getByText("Bounded instructions.")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search selected skill" }), {
      target: { value: "Bounded" },
    });
    expect(screen.getByRole("status")).toHaveTextContent("1 match");
    expect(screen.getByText("Bounded", { selector: "mark" })).toBeInTheDocument();
    expect(skillButton).toHaveFocus();
    expect(fetch).toHaveBeenCalledWith(
      `/api/system/context?id=${encodeURIComponent(skill!.id)}`,
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(JSON.stringify(vi.mocked(fetch).mock.calls)).not.toContain(skill?.path);
  });

  it("opens toolset rows and explains their real configuration state", () => {
    render(<SystemBrowser sources={mockSystemSources} />);
    fireEvent.click(screen.getByRole("button", { name: /Tools.*Capabilities/is }));
    fireEvent.click(
      screen.getByRole("button", { name: /file.*Enabled by platform_toolsets\.cli/is }),
    );

    expect(screen.getByRole("heading", { name: "file" })).toBeInTheDocument();
    expect(screen.getAllByText("Enabled by platform_toolsets.cli.")).toHaveLength(2);
  });

  it("loads additional conversations and changes transcript selection", async () => {
    const nextPage = {
      items: mockConversations.slice(5).map(asConversationSummary),
      nextCursor: null,
      observedAt: "2026-09-07T00:00:00.000Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input: string) => ({
        ok: true,
        json: async () =>
          input.startsWith("/api/conversations?") ? nextPage : mockConversations[5],
      })),
    );
    render(
      <ConversationBrowser
        initialPage={{
          items: mockConversations.slice(0, 5).map(asConversationSummary),
          nextCursor: "cursor-fixture",
          observedAt: "2026-09-07T00:00:00.000Z",
        }}
        initialConversation={mockConversations[0]!}
      />,
    );
    expect(
      screen.getByText("5 sessions loaded. Load older eligible sessions as needed."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Prompt provenance experiment")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    await screen.findByText("Prompt provenance experiment");
    expect(
      screen.getByText(`All ${mockConversations.length} eligible sessions are loaded.`),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Prompt provenance experiment/i }));
    expect(
      await screen.findByRole("heading", { name: "Prompt provenance experiment" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/prompt hash is useful only with provenance/i),
    ).toBeInTheDocument();
  });

  it("renders transcript HTML-like content only as text", () => {
    const malicious = '</script><img src="https://remote.invalid/pixel" onerror="alert(1)">';
    render(
      <ConversationBrowser
        initialPage={{
          items: [asConversationSummary(mockConversations[0]!)],
          nextCursor: null,
          observedAt: "2026-09-07T00:00:00.000Z",
        }}
        initialConversation={{
          ...mockConversations[0]!,
          messages: [
            {
              id: "message-malicious",
              role: "user",
              content: malicious,
              timestamp: "2026-09-07T00:00:00.000Z",
            },
          ],
        }}
      />,
    );

    expect(screen.getByText(malicious)).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("shows metadata-only feedback for unsupported files", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockFiles[3],
      }),
    );
    render(<FileBrowser initialDirectory={mockDirectory} initialFile={mockFiles[0]!} />);
    fireEvent.click(screen.getByRole("button", { name: /tmp_lance_thread.pdf/i }));
    expect(
      await screen.findByRole("heading", { name: "Preview not available" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("metadata-only")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      "/api/files/preview?path=tmp_lance_thread.pdf",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("navigates a directory and loads a selected file preview", async () => {
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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (input: string) => ({
        ok: true,
        json: async () =>
          input.startsWith("/api/files/preview")
            ? { ...nestedFile, content: "# Nested guide\n\nBounded preview." }
            : {
                path: "docs",
                parentPath: "",
                items: [nestedFile],
                observedAt: "2026-09-08T00:00:00.000Z",
                truncated: false,
              },
      })),
    );

    render(
      <FileBrowser
        initialDirectory={{ ...mockDirectory, items: [directoryEntry] }}
        initialFile={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /docs.*Directory/is }));
    expect(
      await screen.findByRole("button", { name: /guide\.md.*Markdown/is }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /guide\.md.*Markdown/is }));
    expect(await screen.findByRole("heading", { name: "guide.md" })).toBeInTheDocument();
    expect(await screen.findByText("Bounded preview.")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search this file" }), {
      target: { value: "Bounded" },
    });
    expect(screen.getByText("1 match", { selector: ".search-count" })).toBeInTheDocument();
    expect(JSON.stringify(vi.mocked(fetch).mock.calls)).not.toContain("COCKPIT_WORKSPACE_ROOT");
  });

  it("renders HTML files as escaped text and encodes unusual relative paths", async () => {
    const unusualPath = "docs/a&b ?#<>.html";
    const html = '<script>window.compromised=true</script><img src="https://remote.invalid/pixel">';
    const file = {
      ...mockFiles[0]!,
      id: unusualPath,
      name: "a&b ?#<>.html",
      path: unusualPath,
      kind: "HTML source",
      content: html,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => file }));

    render(
      <FileBrowser initialDirectory={{ ...mockDirectory, items: [file] }} initialFile={null} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /a&b \?#<>\.html.*HTML source/is }));

    expect(await screen.findByText(html)).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      `/api/files/preview?path=${encodeURIComponent(unusualPath)}`,
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("selects a job and exposes only inspection controls", () => {
    render(<JobsBrowser jobs={mockJobs} />);
    const row = screen.getByRole("row", { name: /Research digest/ });
    fireEvent.click(within(row).getByText("Weekdays at 18:00"));
    expect(screen.getByRole("heading", { name: "Research digest" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Research digest" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("2026-08-02 10:30 CST")).toBeInTheDocument();
    expect(screen.getByText("7 in retained ledger")).toBeInTheDocument();
    expect(screen.getByText("failed ×1")).toBeInTheDocument();
    expect(screen.getByText("web, research")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /run|pause|resume|edit|remove|create/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps job definitions visible when execution history is unavailable", () => {
    render(
      <JobsBrowser
        jobs={mockJobs}
        definitionsState="ready"
        executionsState="unavailable"
        failure="The requested local source is unavailable."
      />,
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("The requested local source is unavailable.")).toBeInTheDocument();
  });

  it("distinguishes running attempts from terminal attempts without finish times", () => {
    const base = mockJobs[0]!;
    render(
      <JobsBrowser
        jobs={[
          {
            ...base,
            executions: [
              {
                id: "running",
                status: "running",
                startedAt: "2026-09-09T02:00:00Z",
                finishedAt: null,
              },
              {
                id: "failed",
                status: "failed",
                startedAt: "2026-09-09T01:00:00Z",
                finishedAt: null,
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Finish time unavailable")).toBeInTheDocument();
  });
});
