import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ClaudeSystemBrowser } from "@/components/claude-system-browser";
import type { ClaudeSystemSnapshot } from "@/contracts/claude-system";

const snapshot: ClaudeSystemSnapshot = {
  sources: [
    {
      key: "source-1",
      category: "Instructions",
      scope: "Project",
      relativePath: "CLAUDE.md",
      state: "ready",
      content:
        "# Testing guide\n\nUse pnpm. [Reference](https://remote.invalid).\n\n![Remote](https://remote.invalid/image.png)",
      truncated: false,
    },
    {
      key: "source-2",
      category: "Memory",
      scope: "Project",
      relativePath: "memory/MEMORY.md",
      state: "ready",
      content: "Remember keyboard navigation",
      truncated: true,
    },
    {
      key: "source-3",
      category: "Skills",
      scope: "User",
      relativePath: "skills/review/SKILL.md",
      state: "ready",
      content: "Review the diff",
      truncated: false,
    },
    {
      key: "source-4",
      category: "Subagents",
      scope: "Project",
      relativePath: ".claude/agents/reviewer.md",
      state: "unavailable",
      content: null,
      truncated: false,
    },
  ],
  observedAt: "2026-09-29T08:00:00.000Z",
  limited: false,
  unavailableScopes: [],
};

describe("Claude System browser", () => {
  afterEach(cleanup);

  it("groups current documents by kind and scope, with source interpretation folded", () => {
    render(<ClaudeSystemBrowser snapshot={snapshot} />);

    expect(screen.getByRole("region", { name: "CLAUDE.md preview" })).toBeInTheDocument();
    for (const category of ["Instructions", "Memory", "Skills", "Subagents"]) {
      expect(screen.getByRole("region", { name: `${category} sources` })).toBeInTheDocument();
    }
    expect(
      within(screen.getByRole("region", { name: "Skills sources" })).getByRole("button"),
    ).toHaveTextContent("User");
    expect(screen.getByText("Source details").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText(/Current discovery does not prove/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("Reference", { selector: ".inert-link" })).toBeInTheDocument();

    fireEvent.click(
      within(screen.getByRole("region", { name: "Memory sources" })).getByRole("button"),
    );
    expect(screen.getByRole("region", { name: "memory/MEMORY.md preview" })).toHaveTextContent(
      "Remember keyboard navigation",
    );
    expect(screen.getByText(/Additional document text is not shown/)).toBeInTheDocument();
  });

  it("searches document names, scopes and displayed contents, with highlighted previews", () => {
    render(<ClaudeSystemBrowser snapshot={snapshot} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search System documents" }), {
      target: { value: "keyboard" },
    });

    expect(screen.getByRole("status")).toHaveTextContent("1 match");
    expect(screen.getByRole("region", { name: "memory/MEMORY.md preview" })).toBeInTheDocument();
    expect(screen.getByText("keyboard", { selector: "mark" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search System documents" }), {
      target: { value: "does not exist" },
    });
    expect(screen.getByRole("heading", { name: "No matching documents" })).toBeInTheDocument();
  });

  it("shows empty and unavailable sources without inventing active settings", () => {
    const { rerender } = render(<ClaudeSystemBrowser snapshot={snapshot} />);
    fireEvent.click(
      within(screen.getByRole("region", { name: "Subagents sources" })).getByRole("button"),
    );
    expect(screen.getByText("This document could not be read safely.")).toBeInTheDocument();

    rerender(
      <ClaudeSystemBrowser
        snapshot={{ ...snapshot, sources: [], limited: true, unavailableScopes: ["User"] }}
      />,
    );
    expect(screen.getByRole("heading", { name: "No System documents found" })).toBeInTheDocument();
    expect(screen.getByText(/Additional sources are not shown/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Some sources could not be read: User.");
  });
});
