import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ClaudeProjectNavigation } from "@/components/claude-project-navigation";
import type { PublicAgentPanel } from "@/contracts/agents";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ push }),
}));
const panel: PublicAgentPanel = {
  id: "claude-code",
  name: "Claude Code",
  runtime: "claude-code",
  surfaces: ["conversations", "overview", "system", "files"],
};
const projects = [
  { id: "atlas", name: "Atlas" },
  { id: "notes", name: "Notes" },
];
afterEach(() => {
  cleanup();
  push.mockClear();
  window.history.replaceState({}, "", "/");
});

it("makes the default project explicit without reloading or dropping a session return target", () => {
  window.history.replaceState(
    {},
    "",
    "/agents/claude-code/conversations?session=task-Example#message-2",
  );
  render(<ClaudeProjectNavigation panel={panel} projects={[projects[0]!]} />);
  const url = new URL(window.location.href);
  expect(url.searchParams.get("project")).toBe("atlas");
  expect(url.searchParams.get("session")).toBe("task-Example");
  expect(url.hash).toBe("#message-2");
  expect(push).not.toHaveBeenCalled();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.getByText("Atlas")).toBeVisible();
});

it("preserves an explicit project in every primary surface link", () => {
  window.history.replaceState({}, "", "/agents/claude-code/system?project=notes");
  render(<ClaudeProjectNavigation panel={panel} projects={projects} />);
  expect(screen.getByRole("combobox", { name: "Project" })).toHaveValue("notes");
  for (const link of screen.getAllByRole("link"))
    expect(link.getAttribute("href")).toContain("project=notes");
  expect(screen.getByRole("link", { name: "System" })).toHaveAttribute("aria-current", "page");
  expect(push).not.toHaveBeenCalled();
});

it("keeps the surface but clears the prior project session, file and return position on a switch", () => {
  window.history.replaceState(
    {},
    "",
    "/agents/claude-code/files?project=atlas&path=src%2Fsettings.ts&session=task-Example#message-2",
  );
  render(<ClaudeProjectNavigation panel={panel} projects={projects} />);
  fireEvent.change(screen.getByRole("combobox", { name: "Project" }), {
    target: { value: "notes" },
  });
  expect(push).toHaveBeenCalledExactlyOnceWith("/agents/claude-code/files?project=notes");
});
