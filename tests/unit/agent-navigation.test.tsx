import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentPanelNavigation } from "@/components/agent-panel-navigation";
import { ScopedAppShell } from "@/components/app-shell";
import { LastPanelCommit } from "@/components/last-panel-commit";
import type { PublicAgentPanel } from "@/contracts/agents";
import { LAST_PANEL_COOKIE } from "@/lib/panel-navigation";

const route = vi.hoisted(() => ({ pathname: "/agents/hermes/system" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

const hermes: PublicAgentPanel = {
  id: "hermes",
  name: "Hermes",
  runtime: "hermes",
  surfaces: ["overview", "system", "conversations", "files", "jobs"],
};
const codex: PublicAgentPanel = {
  id: "codex",
  name: "Codex",
  runtime: "codex",
  surfaces: ["overview", "system", "conversations"],
};

describe("Agent panel navigation", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
    document.cookie = `${LAST_PANEL_COOKIE}=; Path=/; Max-Age=0`;
  });

  it("uses real links, marks location, and falls back from an unsupported surface", () => {
    route.pathname = "/agents/hermes/jobs";
    window.history.replaceState({}, "", route.pathname);
    render(<AgentPanelNavigation activePanel={hermes} panels={[hermes, codex]} />);

    expect(screen.getByRole("navigation", { name: "Agent panels" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Hermes/i })).toHaveAttribute(
      "aria-current",
      "location",
    );
    expect(screen.getByRole("link", { name: /Codex/i })).toHaveAttribute(
      "href",
      "/agents/codex?from=jobs",
    );
  });

  it("does not treat a directly supplied from query as a completed switch", async () => {
    route.pathname = "/agents/codex/system";
    window.history.replaceState({}, "", `${route.pathname}?from=system`);
    render(<AgentPanelNavigation activePanel={codex} panels={[hermes, codex]} />);

    const active = screen.getByRole("link", { name: /Codex/i });
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(active).not.toHaveFocus();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("does not render a redundant selector for a single panel", () => {
    route.pathname = "/agents/codex";
    window.history.replaceState({}, "", route.pathname);
    render(<AgentPanelNavigation activePanel={codex} panels={[codex]} />);
    expect(screen.queryByRole("navigation", { name: "Agent panels" })).not.toBeInTheDocument();
  });

  it("keeps a single scoped panel identifiable without a Hermes profile stamp", () => {
    route.pathname = "/agents/codex";
    window.history.replaceState({}, "", route.pathname);
    const { container } = render(
      <ScopedAppShell activePanel={codex} panels={[codex]}>
        <p>Scoped content</p>
      </ScopedAppShell>,
    );

    expect(container.querySelector(".product-mark")).toHaveTextContent("COCKPIT/ CODEX");
    expect(screen.queryByRole("navigation", { name: "Agent panels" })).not.toBeInTheDocument();
    expect(container.querySelector(".profile-stamp")).not.toBeInTheDocument();
    expect(container.querySelector(".panel-stamp")).toHaveTextContent("ACTIVE AGENTCodex");
  });

  it("commits a validated panel only after the leaf page mounts", async () => {
    render(<LastPanelCommit panelId="codex" />);
    await waitFor(() => expect(document.cookie).toContain(`${LAST_PANEL_COOKIE}=codex`));
  });
});
