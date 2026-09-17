import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { CodexSystemSnapshot } from "@/contracts/codex";
import { CodexSystemBrowser } from "@/features/system/codex-system-browser";

const observedAt = "2026-09-16T08:00:00.000Z";

const snapshot: CodexSystemSnapshot = {
  runtime: { label: "Codex CLI", state: "ready", version: "0.145.0" },
  sources: [
    {
      key: "global-guidance",
      label: "Global guidance",
      origin: "Codex home",
      state: "ready",
      content:
        "# Current guidance\n\nCurrent rule and [reference](https://remote.invalid).\n\n![remote](https://remote.invalid/image.png)",
      truncated: true,
    },
    {
      key: "workspace-guidance",
      label: "Workspace guidance",
      state: "missing",
      message: "No current guidance was observed.",
    },
    {
      key: "custom-guidance",
      label: "Custom guidance",
      state: "unavailable",
      message: "Current guidance is unavailable.",
    },
  ],
  observedAt,
};

describe("Codex System browser", () => {
  afterEach(cleanup);

  it("shows path-free current guidance, searches the bounded preview, and keeps markdown inert", () => {
    render(<CodexSystemBrowser snapshot={snapshot} />);

    expect(screen.getByRole("region", { name: "Global guidance preview" })).toBeInTheDocument();
    expect(screen.getByText("Current, not historical")).toBeInTheDocument();
    expect(
      screen.getByText(/cannot prove the exact context used by a historical task/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/does not rebuild that full chain/i)).toBeInTheDocument();
    expect(screen.getByText(/appears only as Custom guidance/i)).toBeInTheDocument();
    expect(screen.queryByText("SOUL.md")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("reference", { selector: ".inert-link" })).toBeInTheDocument();
    expect(screen.getByText("[Image omitted: remote]", { exact: true })).toBeInTheDocument();
    expect(
      screen.getByText("Preview is bounded. Additional guidance content is not shown."),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search current guidance" }), {
      target: { value: "Current" },
    });
    expect(screen.getByRole("status")).toHaveTextContent("2 matches");
    expect(screen.getAllByText("Current", { selector: "mark" })).toHaveLength(2);

    const ledger = screen.getByRole("complementary", { name: "Current guidance" });
    expect(ledger).toHaveTextContent("Codex CLI");
    expect(ledger).toHaveTextContent("0.145.0");
    expect(ledger).toHaveTextContent("Global guidance");
    expect(ledger.textContent).not.toMatch(/\/Users\/|\.codex|SOUL\.md/u);

    const index = screen.getByRole("region", { name: "Codex runtime and current guidance" });
    fireEvent.click(within(index).getByRole("button", { name: /Custom guidance.*unavailable/is }));
    expect(screen.getByText("Current guidance is unavailable.")).toBeInTheDocument();
  });

  it("renders ready, missing, unavailable, and error guidance states independently", () => {
    const errorSnapshot: CodexSystemSnapshot = {
      ...snapshot,
      runtime: {
        label: "Codex CLI",
        state: "unavailable",
        message: "The requested local source is unavailable.",
      },
      sources: [
        snapshot.sources[0]!,
        snapshot.sources[1]!,
        {
          key: "custom-guidance",
          label: "Custom guidance",
          state: "error",
          message: "Current guidance could not be read safely.",
        },
      ],
    };
    render(<CodexSystemBrowser snapshot={errorSnapshot} />);

    expect(screen.getByRole("region", { name: "Global guidance preview" })).toBeInTheDocument();
    const index = screen.getByRole("region", { name: "Codex runtime and current guidance" });
    expect(
      within(index).getByRole("button", { name: /Codex CLI.*unavailable/is }),
    ).toBeInTheDocument();
    expect(
      within(index).getByRole("button", { name: /Global guidance.*ready/is }),
    ).toBeInTheDocument();
    expect(
      within(index).getByRole("button", { name: /Workspace guidance.*missing/is }),
    ).toBeInTheDocument();
    expect(
      within(index).getByRole("button", { name: /Custom guidance.*error/is }),
    ).toBeInTheDocument();

    fireEvent.click(within(index).getByRole("button", { name: /Workspace guidance.*missing/is }));
    expect(screen.getByRole("heading", { name: "No guidance observed" })).toBeInTheDocument();
    expect(screen.getByText("No current guidance was observed.")).toBeInTheDocument();
    expect(
      screen.queryByRole("searchbox", { name: "Search current guidance" }),
    ).not.toBeInTheDocument();

    fireEvent.click(within(index).getByRole("button", { name: /Custom guidance.*error/is }));
    expect(screen.getByText("Current guidance could not be read safely.")).toBeInTheDocument();

    fireEvent.click(within(index).getByRole("button", { name: /Codex CLI.*unavailable/is }));
    expect(screen.getByText("The requested local source is unavailable.")).toBeInTheDocument();
  });
});
