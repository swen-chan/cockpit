import { expect, test, type Page } from "@playwright/test";

import {
  claudeFixtureIds,
  claudeOtherProjectId,
  forbiddenClaudeFixtureMarkers,
} from "../helpers/claude-fixture";

const scenario = process.env.COCKPIT_E2E_SCENARIO;
const baseURL = process.env.COCKPIT_E2E_BASE_URL;
if (!baseURL) throw new Error("Claude browser tests require COCKPIT_E2E_BASE_URL.");

const conversationsPath = "/agents/claude-code/conversations";
const forbidden = [...forbiddenClaudeFixtureMarkers, ...claudeFixtureIds, claudeOtherProjectId];

function monitorPage(page: Page) {
  const listRequests: string[] = [];
  const detailRequests: string[] = [];
  const remoteRequests: string[] = [];
  const errors: string[] = [];
  const responses: Promise<void>[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/agents/claude-code/conversations") listRequests.push(request.url());
    if (/^\/api\/agents\/claude-code\/conversations\//u.test(url.pathname))
      detailRequests.push(url.pathname);
    if (
      ["http:", "https:"].includes(url.protocol) &&
      !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
    )
      remoteRequests.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (!pathname.startsWith("/api/agents/claude-code/")) return;
    responses.push(
      response.text().then((body) => {
        for (const marker of forbidden) expect(body).not.toContain(marker);
      }),
    );
  });
  return { listRequests, detailRequests, remoteRequests, errors, responses };
}

async function expectPrivateContentHidden(page: Page, monitor: ReturnType<typeof monitorPage>) {
  await Promise.all(monitor.responses);
  const body = await page.locator("body").textContent();
  for (const marker of forbidden) expect(body).not.toContain(marker);
  expect(monitor.remoteRequests).toEqual([]);
  expect(monitor.errors).toEqual([]);
  expect(await page.evaluate(() => "CLAUDE_SCRIPT_EXECUTION" in window)).toBe(false);
}

async function expectNoPageOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
}

function agentLink(page: Page, name: string) {
  return page
    .getByRole("navigation", { name: "Agent panels" })
    .getByRole("link", { name: new RegExp(`^${name}`) });
}

if (scenario === "claude-only") {
  test("opens Claude Conversations with readable titles and paginates without eager detail requests", async ({
    page,
    context,
  }) => {
    const monitor = monitorPage(page);
    await context.addCookies([{ name: "cockpit_last_panel", value: "codex", url: baseURL }]);
    await page.goto("/");
    await expect(page).toHaveURL(`${baseURL}${conversationsPath}?project=atlas`);
    await expect(page).toHaveTitle("Conversations / Claude Code / Cockpit");
    await expect(page.getByRole("navigation", { name: "Agent panels" })).toHaveCount(0);
    const navigation = page.getByRole("navigation", { name: "Primary navigation" });
    await expect(navigation.getByRole("link")).toHaveCount(4);
    await expect(page.getByRole("combobox", { name: "Project", exact: true })).toHaveValue("atlas");
    await expect(
      navigation.getByRole("link", { name: "Conversations", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("heading", { name: "Select a session", exact: true }),
    ).toBeVisible();
    const index = page.getByRole("region", { name: "Claude Code session index" });
    await expect(index.locator(".index-row")).toHaveCount(5);
    const first = index.getByRole("button", { name: /Inspect saved changes/u });
    await expect(first).toContainText("Review the saved changes in this project.");
    await expect(first).toContainText("Recorded directory");
    await expect(first).toContainText("atlas-demo");
    await expect(first).toContainText("Recorded branch");
    await expect(first).toContainText("fix/session-reading");
    await expect(index.getByRole("button", { name: /Saved session 3/u })).not.toContainText(
      "Recorded directory",
    );
    const listRequestsBeforeSearch = [...monitor.listRequests];
    expect(monitor.detailRequests).toEqual([]);
    const listSearch = index.getByRole("searchbox", { name: "Search loaded sessions" });
    await listSearch.fill("atlas-demo");
    await expect(index.locator(".index-row")).toHaveCount(2);
    await expect(first).toBeVisible();
    await expect(index.getByRole("button", { name: /Continue after compaction/u })).toBeVisible();
    await listSearch.fill("FIX/SESSION-READING");
    await expect(index.locator(".index-row")).toHaveCount(1);
    await expect(first).toBeVisible();
    await listSearch.fill("this project");
    await expect(index.locator(".index-row")).toHaveCount(1);
    await expect(first).toBeVisible();
    await listSearch.fill("Saved session 7");
    await expect(index.getByRole("heading", { name: "No matching sessions" })).toBeVisible();
    expect(monitor.listRequests).toEqual(listRequestsBeforeSearch);
    expect(monitor.detailRequests).toEqual([]);
    await page.getByRole("button", { name: "Show more", exact: true }).click();
    await expect(index.getByRole("button", { name: /Saved session 7/u })).toBeVisible();
    await expect(index.locator(".index-row")).toHaveCount(1);
    await listSearch.fill("");
    await expect(index.locator(".index-row")).toHaveCount(7);
    expect(monitor.detailRequests).toEqual([]);
    await expect(page.getByRole("button", { name: "Show more", exact: true })).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await context.cookies(baseURL)).find((cookie) => cookie.name === "cockpit_last_panel")
            ?.value,
      )
      .toBe("claude-code");
    await expectPrivateContentHidden(page, monitor);
  });

  test("keeps recent conversation readable and folds source and message-owned tool evidence", async ({
    page,
  }) => {
    const monitor = monitorPage(page);
    await page.goto(conversationsPath);
    await page.getByRole("button", { name: /Inspect saved changes/u }).click();
    await expect(
      page.getByText("The selected saved changes are ready to inspect.", { exact: false }),
    ).toBeVisible();
    expect(monitor.detailRequests).toHaveLength(1);
    await expect(
      page.getByText("Saved conversation as read. Most recent first.", { exact: true }),
    ).toBeVisible();
    const messages = page.locator(".message");
    await expect(messages).toHaveCount(4);
    await expect(messages.first()).toContainText(
      "The selected saved changes are ready to inspect.",
    );
    await expect(messages.first().locator(".claude-activity-disclosure")).toHaveCount(0);
    await expect(messages.nth(1)).toContainText("I will check the revised changes.");
    await expect(messages.last()).toContainText("Review the saved changes in this project.");
    await expect(page.locator(".message-user")).toHaveCount(1);

    const source = page.locator(".claude-source-disclosure");
    await expect(source).not.toHaveAttribute("open", "");
    await expect(source.locator(":scope > summary")).toHaveText("Source details");
    await expect(source.getByText("Configured Claude Code session directory")).not.toBeVisible();
    const activities = page.locator(".claude-activity-disclosure");
    await expect(activities).toHaveCount(2);
    await expect(page.locator(".claude-activity-disclosure[open]")).toHaveCount(0);
    const initialTools = messages.nth(2);
    await expect(initialTools.locator("header")).toContainText("Tool activity");
    const activity = initialTools.locator(".claude-activity-disclosure");
    const activitySummary = activity.locator(":scope > summary");
    await expect(activitySummary).toContainText("Recorded error");
    await expect(activitySummary).toContainText("No result recorded");
    await expect(activitySummary).toBeVisible();
    await activitySummary.focus();
    await activitySummary.press("Enter");
    await expect(activity).toHaveAttribute("open", "");
    const initialList = activity.locator(".claude-activity-list");
    await expect(initialList.getByText("Result recorded", { exact: true })).toHaveCount(1);
    await expect(initialList.getByText("Recorded error", { exact: true })).toHaveCount(1);
    await expect(initialList.getByText("No result recorded", { exact: true })).toHaveCount(2);
    for (const label of ["Read src/settings.ts", "Recorded command", "Edit file", "Other tool"]) {
      await expect(initialList.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(initialList.locator("li").filter({ hasText: "Recorded command" })).toContainText(
      "Recorded error",
    );
    const meaning = activity.locator(".claude-activity-notes");
    await expect(meaning).not.toHaveAttribute("open", "");
    await expect(meaning.locator(":scope > summary")).toHaveText("Meaning of these records");
    await meaning.locator(":scope > summary").focus();
    await meaning.locator(":scope > summary").press("Enter");
    await expect(meaning).toHaveAttribute("open", "");

    const recheck = messages.nth(1).locator(".claude-activity-disclosure");
    await expect(recheck.locator(":scope > summary")).not.toContainText("Recorded error");
    await recheck.locator(":scope > summary").click();
    const recheckList = recheck.locator(".claude-activity-list");
    await expect(recheckList.locator("li")).toHaveCount(1);
    await expect(recheckList.getByText("Recorded command", { exact: true })).toBeVisible();
    await expect(recheckList.getByText("pnpm test", { exact: true })).toBeVisible();
    await recheckList.locator(".claude-result > summary").click();
    await expect(
      recheckList.getByText("12 settings checks passed.", { exact: false }),
    ).toBeVisible();
    await expect(recheckList.getByText("Result recorded", { exact: true })).toBeVisible();
    await expect(recheckList.getByText("Recorded error", { exact: true })).toHaveCount(0);
    await source.locator(":scope > summary").focus();
    await source.locator(":scope > summary").press("Enter");
    await expect(source).toHaveAttribute("open", "");
    await expect(source.getByText("Configured Claude Code session directory")).toBeVisible();
    await expect(source).toContainText("Recorded directory");
    await expect(source).toContainText("atlas-demo");
    await expect(source).toContainText("Recorded branch");
    await expect(source).toContainText("fix/session-reading");
    await page
      .getByRole("searchbox", { name: "Search loaded conversation" })
      .fill("selected saved changes");
    await expect(page.locator(".search-count")).toHaveText("1 match");
    expect(monitor.detailRequests).toHaveLength(1);
    expect(monitor.listRequests).toEqual([]);
    await expectPrivateContentHidden(page, monitor);
  });

  test("labels a saved compaction summary separately from user messages", async ({ page }) => {
    const monitor = monitorPage(page);
    await page.goto(conversationsPath);
    await page.getByRole("button", { name: /Continue after compaction/u }).click();
    await expect(page.getByText("Continued from saved context.", { exact: true })).toBeVisible();
    await expect(page.getByText("Compaction summary", { exact: true })).toBeVisible();
    await expect(page.getByText("Saved context from earlier work.", { exact: true })).toBeVisible();
    await expect(page.getByText("Earlier saved response.", { exact: true })).toHaveCount(0);
    await expectPrivateContentHidden(page, monitor);
  });

  test("keeps Claude API reads scoped and rejects mutations and browser-supplied source paths", async ({
    request,
  }) => {
    const endpoint = "/api/agents/claude-code/conversations";
    for (const route of [
      endpoint,
      `${endpoint}/task-invalid`,
      "/api/agents/claude-code/overview",
      "/api/agents/claude-code/system",
      "/api/agents/claude-code/files",
      "/api/agents/claude-code/files/preview",
    ]) {
      for (const method of ["post", "put", "patch", "delete"] as const) {
        const response = await request[method](route);
        expect(response.status(), `${method} ${route}`).toBe(405);
        expect(response.headers()["cache-control"]).toBe("private, no-store");
      }
    }
    for (const route of [
      `${endpoint}?source=/private/browser-source`,
      `${endpoint}?cursor=invalid`,
      `${endpoint}?project=unknown`,
      `${endpoint}?project=atlas&project=notes`,
      `${endpoint}/${claudeFixtureIds[0]}`,
    ]) {
      const response = await request.get(route);
      expect(response.status()).toBe(400);
      expect(await response.json()).toMatchObject({ code: "invalid_path" });
    }
    for (const surface of ["overview", "system", "files"]) {
      const response = await request.get(`/api/agents/claude-code/${surface}?project=atlas`);
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toBe("private, no-store");
    }
    for (const surface of ["jobs"]) {
      const response = await request.get(`/api/agents/claude-code/${surface}`);
      expect(response.status()).toBe(404);
      expect(await response.json()).toMatchObject({ code: "unsupported_capability" });
    }
    const badOrigin = await request.get(endpoint, { headers: { Origin: "https://evil.test" } });
    expect(badOrigin.status()).toBe(403);
    const listResponse = await request.get(endpoint);
    expect(listResponse.headers()["cache-control"]).toBe("private, no-store");
    for (const marker of forbidden) expect(await listResponse.text()).not.toContain(marker);
  });

  test("opens a recorded file in the same project and returns to its owning session", async ({
    page,
  }) => {
    const monitor = monitorPage(page);
    await page.goto(conversationsPath);
    await page.getByRole("button", { name: /Inspect saved changes/u }).click();
    const initialTools = page.locator(".message").nth(2);
    const ownerId = await initialTools.getAttribute("id");
    expect(ownerId).toMatch(/^message-[1-9][0-9]*$/u);
    await initialTools.locator(".claude-activity-disclosure > summary").click();
    await initialTools.getByRole("link", { name: "Open file", exact: true }).click();
    await expect(page).toHaveURL(
      /\/agents\/claude-code\/files\?project=atlas&path=src%2Fsettings\.ts&session=task-/u,
    );
    await expect(page.getByRole("heading", { name: "settings.ts", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "settings.ts preview" })).toContainText(
      "notifications: true",
    );
    await page.getByRole("link", { name: "Back to session", exact: true }).click();
    await expect(page).toHaveURL(
      /\/agents\/claude-code\/conversations\?project=atlas&session=task-/u,
    );
    await expect(page).toHaveURL(new RegExp(`#${ownerId}$`, "u"));
    const owner = page.locator(`#${ownerId}`);
    await expect(owner).toBeFocused();
    await expect(owner).toBeInViewport();
    await expect(owner.locator(".claude-activity-disclosure")).toHaveAttribute("open", "");
    await expect(page.locator("#claude-session-title")).toHaveText("Inspect saved changes");
    await expect(
      page.getByText("The selected saved changes are ready to inspect.", { exact: false }),
    ).toBeVisible();
    await expectPrivateContentHidden(page, monitor);
  });

  test("keeps the selected project across Overview, Conversations, System and Files", async ({
    page,
  }) => {
    const monitor = monitorPage(page);
    await page.goto(conversationsPath);
    const project = page.getByRole("combobox", { name: "Project", exact: true });
    await project.selectOption("notes");
    await expect(page.getByRole("button", { name: /Plan the release notes/u })).toBeVisible();
    await expect(page.getByRole("button", { name: /Inspect saved changes/u })).toHaveCount(0);
    const navigation = page.getByRole("navigation", { name: "Primary navigation" });
    await navigation.getByRole("link", { name: "Overview", exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}/agents/claude-code?project=notes`);
    await expect(
      page.getByRole("heading", { name: "Recent conversations", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /Plan the release notes/u })).toBeVisible();
    await page.getByRole("link", { name: "Inspect System", exact: true }).click();
    await expect(project).toHaveValue("notes");
    await expect(page.getByRole("region", { name: "CLAUDE.md preview" })).toContainText(
      "Notes guidance",
    );
    await expect(page.getByRole("main")).not.toContainText("Atlas guidance");
    await page
      .getByRole("searchbox", { name: "Search System documents", exact: true })
      .fill("Notes memory");
    await expect(page.getByRole("region", { name: "memory/MEMORY.md preview" })).toContainText(
      "Publish release notes after human review.",
    );
    await navigation.getByRole("link", { name: "Files", exact: true }).click();
    await expect(project).toHaveValue("notes");
    await page.getByRole("button", { name: /docs/u }).click();
    await page.getByRole("button", { name: /release-plan\.md/u }).click();
    await expect(page.getByRole("region", { name: "release-plan.md preview" })).toContainText(
      "Describe the changes and known limits.",
    );
    await project.selectOption("atlas");
    await navigation.getByRole("link", { name: "System", exact: true }).click();
    await expect(page.getByRole("region", { name: "CLAUDE.md preview" })).toContainText(
      "Atlas guidance",
    );
    for (const category of ["Instructions", "Memory", "Skills", "Subagents"])
      await expect(page.getByRole("region", { name: `${category} sources` })).toBeVisible();
    await expectPrivateContentHidden(page, monitor);
  });

  for (const width of [320, 390]) {
    test(`keeps Claude sessions and tool disclosures usable at ${width}px`, async ({ page }) => {
      const monitor = monitorPage(page);
      await page.setViewportSize({ width, height: 800 });
      await page.goto(conversationsPath);
      await expect(page.getByRole("combobox", { name: "Project", exact: true })).toBeVisible();
      for (const name of ["Overview", "Conversations", "System", "Files"])
        await expect(
          page
            .getByRole("navigation", { name: "Primary navigation" })
            .getByRole("link", { name, exact: true }),
        ).toBeVisible();
      await page.getByRole("searchbox", { name: "Search loaded sessions" }).fill("saved");
      await page.getByRole("button", { name: /Inspect saved changes/u }).click();
      const title = page.locator("#claude-session-title");
      await expect(title).toBeFocused();
      const summaries = page.locator(".claude-activity-disclosure > summary");
      await expect(summaries).toHaveCount(2);
      for (const summary of await summaries.all()) {
        const summaryBox = await summary.boundingBox();
        expect(summaryBox).not.toBeNull();
        expect(summaryBox!.height).toBeGreaterThanOrEqual(44);
      }
      const [navigationBox, titleBox] = await Promise.all([
        page.locator(".navigation-rail").boundingBox(),
        title.boundingBox(),
      ]);
      expect(navigationBox).not.toBeNull();
      expect(titleBox).not.toBeNull();
      expect(titleBox!.y).toBeGreaterThanOrEqual(navigationBox!.y + navigationBox!.height - 1);
      for (const summary of await summaries.all()) await summary.click();
      const sourceSummary = page.locator(".claude-source-disclosure > summary");
      await sourceSummary.focus();
      await sourceSummary.press("Enter");
      await expect(page.locator(".claude-source-disclosure")).toHaveAttribute("open", "");
      await expectNoPageOverflow(page);
      await expectPrivateContentHidden(page, monitor);
    });
  }
}

if (scenario === "triple-ready") {
  test("falls back from Hermes Jobs and preserves supported surfaces when switching to Claude", async ({
    page,
  }) => {
    {
      await page.goto("/agents/hermes/jobs");
      await agentLink(page, "Claude Code").click();
      await expect(page).toHaveURL(`${baseURL}${conversationsPath}?project=atlas`);
      await expect(agentLink(page, "Claude Code")).toBeFocused();
      await expect(page.locator(".scope-fallback-notice")).toContainText(
        "Opened Conversations instead.",
      );
      await expect(page.getByRole("button", { name: /Inspect saved changes/u })).toBeVisible();
      await expect(
        page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link"),
      ).toHaveCount(4);
    }
    await page.goto("/agents/codex/system");
    await agentLink(page, "Claude Code").click();
    await expect(page).toHaveURL(`${baseURL}/agents/claude-code/system?project=atlas`);
    await expect(
      page.getByRole("heading", { level: 1, name: "System", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".scope-fallback-notice")).toHaveCount(0);
    await page.getByRole("combobox", { name: "Project", exact: true }).selectOption("notes");
    await agentLink(page, "Claude Code").click();
    await expect(page).toHaveURL(`${baseURL}/agents/claude-code/system?project=notes`);
    await expect(page.getByRole("combobox", { name: "Project", exact: true })).toHaveValue("notes");
    await expect(page.getByRole("region", { name: "CLAUDE.md preview" })).toContainText(
      "Notes guidance",
    );
    await page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Conversations", exact: true })
      .click();
    await agentLink(page, "Codex").click();
    await expect(page).toHaveURL(`${baseURL}/agents/codex/conversations`);
    await expect(page.getByRole("heading", { level: 1, name: "Tasks", exact: true })).toBeVisible();
    await agentLink(page, "Claude Code").click();
    await expect(page).toHaveURL(`${baseURL}${conversationsPath}?project=atlas`);
    await expect(page.locator(".scope-fallback-notice")).toHaveCount(0);
    await agentLink(page, "Hermes").click();
    await expect(page).toHaveURL(`${baseURL}/agents/hermes/conversations`);
  });

  test("keeps inactive Claude requests deferred and honors its remembered landing page", async ({
    page,
    context,
  }) => {
    const claudeRequests: string[] = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (
        pathname.startsWith("/agents/claude-code") ||
        pathname.startsWith("/api/agents/claude-code")
      )
        claudeRequests.push(pathname);
    });
    await page.goto("/agents/hermes");
    const unexpectedPrefetch = page
      .waitForRequest(
        (request) => new URL(request.url()).pathname.includes("/agents/claude-code"),
        { timeout: 750 },
      )
      .then(
        () => true,
        () => false,
      );
    await agentLink(page, "Claude Code").hover();
    await agentLink(page, "Claude Code").focus();
    expect(await unexpectedPrefetch).toBe(false);
    expect(claudeRequests).toEqual([]);
    await agentLink(page, "Claude Code").click();
    await expect(page).toHaveURL(`${baseURL}/agents/claude-code?project=atlas`);
    await expect
      .poll(
        async () =>
          (await context.cookies(baseURL)).find((cookie) => cookie.name === "cockpit_last_panel")
            ?.value,
      )
      .toBe("claude-code");
    await page.goto("/");
    await expect(page).toHaveURL(`${baseURL}${conversationsPath}?project=atlas`);
    await page.setViewportSize({ width: 320, height: 800 });
    for (const name of ["Hermes", "Codex", "Claude Code"])
      await expect(agentLink(page, name)).toBeVisible();
    await expectNoPageOverflow(page);
  });
}

if (scenario === "claude-empty") {
  test("distinguishes an empty configured Claude source from a source failure", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(`${baseURL}${conversationsPath}?project=atlas`);
    const main = page.getByRole("main");
    const emptyState = main.locator(".index-pane .source-state-empty");
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toHaveAttribute("role", "status");
    // Next.js also mounts a route-announcement alert outside the application main.
    await expect(main.getByRole("alert")).toHaveCount(0);
    const response = await request.get("/api/agents/claude-code/conversations");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ panelId: "claude-code", data: { items: [] } });
  });
}

if (scenario === "claude-missing") {
  test("keeps the configured Claude panel selected when its source is missing", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(`${baseURL}${conversationsPath}?project=atlas`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Conversations", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("The requested local source is unavailable.", { exact: true }),
    ).toBeVisible();
    const response = await request.get("/api/agents/claude-code/conversations");
    expect(response.status()).toBe(503);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ panelId: "claude-code", code: "missing_source" });
    const projectConfiguration = JSON.parse(process.env.COCKPIT_CLAUDE_PROJECTS!) as {
      sessionRoot: string;
    }[];
    expect(await response.text()).not.toContain(projectConfiguration[0]!.sessionRoot);
  });
}
