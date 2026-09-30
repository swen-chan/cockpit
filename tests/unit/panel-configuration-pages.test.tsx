import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import HomePage from "@/app/page";
import AgentLayout from "@/app/agents/[panelId]/layout";
import AgentOverviewPage from "@/app/agents/[panelId]/page";
import AgentConversationsPage from "@/app/agents/[panelId]/conversations/page";
import AgentFilesPage from "@/app/agents/[panelId]/files/page";
import AgentJobsPage from "@/app/agents/[panelId]/jobs/page";
import AgentSystemPage from "@/app/agents/[panelId]/system/page";

const headers = vi.hoisted(() => ({ remembered: "", cookies: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: headers.cookies }));

const readers = vi.hoisted(() => ({
  read: vi.fn(() => {
    throw new Error("Unexpected source read.");
  }),
}));
vi.mock("@/server/services/agents", () => ({
  loadAgentOverview: readers.read,
  loadAgentSystem: readers.read,
}));
vi.mock("@/server/services/codex-tasks", () => ({ loadCodexTaskPage: readers.read }));
vi.mock("@/server/services/conversations", () => ({ loadConversationPageData: readers.read }));
vi.mock("@/server/services/files", () => ({ loadFilesPageData: readers.read }));
vi.mock("@/server/services/jobs", () => ({ loadJobsPageData: readers.read }));
vi.mock("@/server/services/system", () => ({ loadSystemPageData: readers.read }));

beforeEach(() => {
  for (const key of [
    "COCKPIT_CLAUDE_SESSION_ROOT",
    "COCKPIT_CLAUDE_PROJECTS",
    "COCKPIT_CLAUDE_USER_ROOT",
    "COCKPIT_CODEX_HOME",
    "COCKPIT_CODEX_WORKSPACE_ROOT",
    "COCKPIT_CODEX_CUSTOM_GUIDANCE",
    "COCKPIT_DEFAULT_PANEL",
    "COCKPIT_WORKSPACE_ROOT",
    "COCKPIT_SOURCE_PRESET",
    "COCKPIT_SOURCE_MANIFEST",
    "COCKPIT_HERMES_HOME",
    "HERMES_HOME",
  ])
    vi.stubEnv(key, "");
  vi.stubEnv("COCKPIT_BUILD_SOURCE_READ_GUARD", "1");
  headers.remembered = "";
  headers.cookies.mockClear();
  readers.read.mockClear();
  headers.cookies.mockResolvedValue({ get: () => ({ value: headers.remembered }) });
});

afterEach(() => vi.unstubAllEnvs());

describe("configuration page boundaries", () => {
  it.each(["unconfigured", "invalid"])(
    "stops every page before source reads when configuration is %s",
    async (state) => {
      if (state === "invalid") vi.stubEnv("COCKPIT_CODEX_HOME", "PRIVATE_INVALID_CONFIG_MARKER");
      const params = Promise.resolve({ panelId: "hermes" });
      const pages = await Promise.all([
        AgentOverviewPage({ params, searchParams: Promise.resolve({}) }),
        AgentConversationsPage({ params }),
        AgentFilesPage({ params }),
        AgentJobsPage({ params }),
        AgentSystemPage({ params }),
      ]);
      expect(pages).toEqual([null, null, null, null, null]);
      const home = renderToStaticMarkup(await HomePage());
      const layout = renderToStaticMarkup(
        await AgentLayout({ params, children: <p>PAGE_CHILD_MARKER</p> }),
      );
      const heading = state === "invalid" ? "Invalid Agent configuration" : "No Agent configured";
      for (const html of [home, layout]) {
        expect(html).toContain(heading);
        expect(html).toContain("Read the configuration guide");
        expect(html).not.toContain("PRIVATE_INVALID_CONFIG_MARKER");
        expect(html).not.toContain("PAGE_CHILD_MARKER");
      }
      expect(headers.cookies).not.toHaveBeenCalled();
      expect(readers.read).not.toHaveBeenCalled();
    },
  );

  it("uses the remembered configured panel at the root without reading its source", async () => {
    vi.stubEnv("COCKPIT_WORKSPACE_ROOT", "/synthetic/hermes");
    vi.stubEnv("COCKPIT_SOURCE_PRESET", "hermes-v2026.9.11");
    vi.stubEnv("COCKPIT_CODEX_HOME", "/synthetic/codex");
    headers.remembered = "codex";
    await expect(HomePage()).rejects.toMatchObject({
      digest: expect.stringContaining("/agents/codex"),
    });
  });

  it("falls back to the sole configured panel for a stale remembered value", async () => {
    vi.stubEnv("COCKPIT_WORKSPACE_ROOT", "/synthetic/hermes");
    vi.stubEnv("COCKPIT_SOURCE_PRESET", "hermes-v2026.9.11");
    headers.remembered = "codex";
    await expect(HomePage()).rejects.toMatchObject({
      digest: expect.stringContaining("/agents/hermes"),
    });
  });
});

it("opens Claude's Conversations from the root without source reads", async () => {
  vi.stubEnv(
    "COCKPIT_CLAUDE_PROJECTS",
    JSON.stringify([
      {
        id: "atlas",
        name: "Atlas",
        sessionRoot: "/synthetic/claude-sessions",
        workspaceRoot: "/synthetic/workspace",
      },
    ]),
  );
  await expect(HomePage()).rejects.toMatchObject({
    digest: expect.stringContaining("/agents/claude-code/conversations"),
  });
  expect(readers.read).not.toHaveBeenCalled();
});
