import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationBrowser } from "@/features/conversations/conversation-browser";
import { mockConversations } from "@/lib/mock-data";

function summary(conversation: (typeof mockConversations)[number]) {
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

describe("scoped client response isolation", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("drops a valid old-panel response after the scoped URL changes", async () => {
    type MockResponse = { ok: boolean; json: () => Promise<unknown> };
    let resolveFetch!: (response: MockResponse) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<MockResponse>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/agents/hermes/conversations");

    render(
      <ConversationBrowser
        initialPage={{
          items: mockConversations.slice(0, 2).map(summary),
          nextCursor: null,
          observedAt: "2026-09-16T08:00:00.000Z",
        }}
        initialConversation={mockConversations[0]!}
        panelId="hermes"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(mockConversations[1]!.title, "i") }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/agents/hermes/conversations/${encodeURIComponent(mockConversations[1]!.id)}`,
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
    );

    window.history.replaceState({}, "", "/agents/codex/conversations");
    await act(async () => {
      resolveFetch({
        ok: true,
        json: async () => ({
          panelId: "hermes",
          runtime: "hermes",
          data: mockConversations[1],
        }),
      });
      await Promise.resolve();
    });

    expect(screen.getByRole("article", { name: mockConversations[1]!.title })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.queryByText(mockConversations[1]!.messages[0]!.content)).not.toBeInTheDocument();
  });

  it("uses the server-fixed page size for scoped Hermes pagination", async () => {
    const next = summary(mockConversations[2]!);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return {
        ok: true,
        json: async () => ({
          panelId: "hermes",
          runtime: "hermes",
          data: {
            items: [next],
            nextCursor: null,
            observedAt: "2026-09-16T08:00:00.000Z",
          },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/agents/hermes/conversations");

    render(
      <ConversationBrowser
        initialPage={{
          items: mockConversations.slice(0, 2).map(summary),
          nextCursor: "cursor-NextPage",
          observedAt: "2026-09-16T08:00:00.000Z",
        }}
        initialConversation={mockConversations[0]!}
        panelId="hermes"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agents/hermes/conversations?cursor=cursor-NextPage",
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("limit=");
  });
});
