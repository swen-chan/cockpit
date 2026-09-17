import { expect, test, type Page } from "@playwright/test";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Codex surface tests require ${name}.`);
  return value;
}

const codexHome = requiredEnvironment("COCKPIT_CODEX_HOME");
const workspaceRoot = requiredEnvironment("COCKPIT_CODEX_WORKSPACE_ROOT");
const forbiddenSourceMarkers = [
  "FORBIDDEN_LOWER_PRECEDENCE_GLOBAL_MARKER",
  codexHome,
  workspaceRoot,
] as const;

interface BrowserObservation {
  readonly consoleErrors: string[];
  readonly externalRequests: string[];
  readonly pageErrors: string[];
  readonly responseBodies: Array<Promise<string | null>>;
}

function observeBrowser(page: Page): BrowserObservation {
  const observation: BrowserObservation = {
    consoleErrors: [],
    externalRequests: [],
    pageErrors: [],
    responseBodies: [],
  };
  page.on("console", (message) => {
    if (message.type() === "error") observation.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => observation.pageErrors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      ["http:", "https:"].includes(url.protocol) &&
      !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
    ) {
      observation.externalRequests.push(request.url());
    }
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith("/agents/codex") && !url.pathname.startsWith("/api/agents/codex"))
      return;
    observation.responseBodies.push(response.text().catch(() => null));
  });
  return observation;
}

async function expectSafeSurface(page: Page, observation: BrowserObservation): Promise<void> {
  const [html, responseBodies] = await Promise.all([
    page.content(),
    Promise.all(observation.responseBodies),
  ]);
  for (const marker of forbiddenSourceMarkers) {
    expect(html).not.toContain(marker);
    for (const body of responseBodies) {
      if (body !== null) expect(body).not.toContain(marker);
    }
  }
  expect(observation.consoleErrors).toEqual([]);
  expect(observation.pageErrors).toEqual([]);
  expect(observation.externalRequests).toEqual([]);
}

async function expectNoPageOverflow(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
}

test("renders a truthful Codex Overview without invented Jobs", async ({ page }) => {
  const observation = observeBrowser(page);
  await page.goto("/agents/codex");

  await expect(page.getByRole("heading", { level: 1, name: "Overview", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("region", { name: "Codex status register" })).toContainText(
    "0.145.0",
  );
  const recentTasks = page.locator('[aria-label="Recent Codex Tasks"]');
  await expect(recentTasks.locator(".register-row")).toHaveCount(5);
  await expect(recentTasks.getByText("PROJECT /", { exact: true })).toHaveCount(5);
  await expect(recentTasks.getByText("cockpit-project", { exact: true })).toBeVisible();
  await expect(recentTasks.getByText("UNKNOWN", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: "Current guidance", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Global guidance", { exact: true })).toBeVisible();
  await expect(page.getByText("Workspace guidance", { exact: true })).toBeVisible();
  await expect(page.getByText("Custom guidance", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Files", exact: true })).toBeVisible();
  const overviewSections = page.locator(".overview-grid > section");
  const taskSection = overviewSections.filter({
    has: page.getByRole("heading", { level: 2, name: "Tasks", exact: true }),
  });
  const guidanceSection = overviewSections.filter({
    has: page.getByRole("heading", { level: 2, name: "Current guidance", exact: true }),
  });
  const filesSection = overviewSections.filter({
    has: page.getByRole("heading", { level: 2, name: "Files", exact: true }),
  });
  await expect(taskSection.getByRole("link", { name: "Tasks", exact: true })).toHaveAttribute(
    "href",
    "/agents/codex/conversations",
  );
  await expect(guidanceSection.getByRole("link", { name: "System", exact: true })).toHaveAttribute(
    "href",
    "/agents/codex/system",
  );
  await expect(filesSection.getByRole("link", { name: "Files", exact: true })).toHaveAttribute(
    "href",
    "/agents/codex/files",
  );
  await expect(page.getByRole("link", { name: "Jobs", exact: true })).toHaveCount(0);
  await expect(page.getByText(/0 jobs/iu)).toHaveCount(0);
  await expectNoPageOverflow(page);
  await expectSafeSurface(page, observation);
});

test("inspects only current Codex guidance with inert searchable previews", async ({ page }) => {
  const observation = observeBrowser(page);
  await page.goto("/agents/codex/system");

  await expect(page.getByRole("heading", { level: 1, name: "System", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByText(/current observable guidance without reconstructing historical task context/iu),
  ).toBeVisible();
  await expect(page.getByText("Current, not historical", { exact: true })).toBeVisible();
  await expect(page.locator(".exclusion-note")).toContainText(
    "it does not rebuild that full chain",
  );

  const globalPreview = page.getByRole("region", { name: "Global guidance preview" });
  await expect(globalPreview).toContainText("SAFE_GLOBAL_GUIDANCE_MARKER");
  await expect(globalPreview.locator("a, img, script, iframe, object, embed")).toHaveCount(0);
  expect(await page.evaluate(() => "FORBIDDEN_GUIDANCE_SCRIPT_EXECUTION" in window)).toBe(false);
  await page
    .getByRole("searchbox", { name: "Search current guidance" })
    .fill("SAFE_GLOBAL_GUIDANCE_MARKER");
  await expect(page.locator(".search-count")).toHaveText("1 match");
  await expect(globalPreview.locator("mark")).toContainText("SAFE_GLOBAL_GUIDANCE_MARKER");

  const index = page.getByRole("region", { name: "Codex runtime and current guidance" });
  await index.getByRole("button", { name: /Workspace guidance.*ready/is }).click();
  await expect(page.getByRole("region", { name: "Workspace guidance preview" })).toContainText(
    "SAFE_WORKSPACE_GUIDANCE_MARKER",
  );
  await index.getByRole("button", { name: /Custom guidance.*ready/is }).click();
  await expect(page.getByRole("region", { name: "Custom guidance preview" })).toContainText(
    "SAFE_CUSTOM_GUIDANCE_MARKER",
  );
  await expect(page.getByText("SOUL.md", { exact: false })).toHaveCount(0);
  await expectNoPageOverflow(page);
  await expectSafeSurface(page, observation);
});

test("browses the approved Codex root with inert, metadata-only, and empty states", async ({
  page,
}) => {
  const observation = observeBrowser(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/agents/codex/files");

  await expect(page.getByRole("heading", { level: 1, name: "Files", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: /README\.md.*Markdown/is }).click();
  const preview = page.getByRole("region", { name: "README.md preview" });
  await expect(preview).toContainText("SAFE_FILE_PREVIEW_MARKER");
  await expect(preview.locator("a, img, script, iframe, object, embed")).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search this file" }).fill("SAFE_FILE_PREVIEW_MARKER");
  await expect(page.locator(".search-count")).toHaveText("1 match");

  await page.getByRole("button", { name: /metadata\.bin.*Unsupported file/is }).click();
  await expect(
    page.getByRole("heading", { level: 3, name: "Preview not available", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("complementary", { name: "File metadata" })).toContainText(
    "metadata-only",
  );

  await page.getByRole("button", { name: /empty-directory.*Directory/is }).click();
  await expect(page.getByLabel("Current workspace directory empty-directory")).toBeVisible();
  await expect(
    page.getByText("The approved directory contains no visible entries.", { exact: true }),
  ).toBeVisible();
  await expectNoPageOverflow(page);
  await expectSafeSurface(page, observation);
});
