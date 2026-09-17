import { existsSync, readFileSync } from "node:fs";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const cookieName = "cockpit_last_panel";
function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Scoped browser tests require ${name}.`);
  return value;
}
const baseURL = requiredEnvironment("COCKPIT_E2E_BASE_URL");
const auditLog = requiredEnvironment("COCKPIT_E2E_CODEX_AUDIT_LOG");

function auditEntries(): string[] {
  if (!existsSync(auditLog)) return [];
  const entries = readFileSync(auditLog, "utf8").split("\n").filter(Boolean);
  for (const entry of entries) expect(["version", "app-server"]).toContain(entry);
  return entries;
}

async function setPanelCookie(context: BrowserContext, value: string): Promise<void> {
  await context.addCookies([{ name: cookieName, value, url: baseURL }]);
}

async function panelCookie(context: BrowserContext): Promise<string | undefined> {
  return (await context.cookies(baseURL)).find((cookie) => cookie.name === cookieName)?.value;
}

async function expectPanelCookie(context: BrowserContext, value: string): Promise<void> {
  await expect.poll(() => panelCookie(context)).toBe(value);
}

function activeAgent(page: Page, name: "Hermes" | "Codex") {
  return page
    .getByRole("navigation", { name: "Agent panels" })
    .getByRole("link", { name: new RegExp(`^${name}`) });
}

test("opens the deterministic Hermes default without a picker or inactive Codex prefetch", async ({
  page,
  context,
}) => {
  const requests: string[] = [];
  const auditBefore = auditEntries().length;
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/agents/codex") || pathname.startsWith("/api/agents/codex")) {
      requests.push(pathname);
    }
  });

  await page.goto("/");
  await expect(page).toHaveURL(`${baseURL}/agents/hermes`);
  await expect(page).toHaveTitle("Overview / Hermes / Cockpit");
  await expect(
    page.getByRole("heading", { level: 1, name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Agent panels" })).toBeVisible();
  await expect(activeAgent(page, "Hermes")).toHaveAttribute("aria-current", "location");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(/choose an agent/i)).toHaveCount(0);
  await expectPanelCookie(context, "hermes");

  const codexLink = activeAgent(page, "Codex");
  const unexpectedPrefetch = page
    .waitForRequest(
      (request) => {
        const pathname = new URL(request.url()).pathname;
        return pathname.startsWith("/agents/codex") || pathname.startsWith("/api/agents/codex");
      },
      { timeout: 750 },
    )
    .then(
      () => true,
      () => false,
    );
  await codexLink.hover();
  await codexLink.focus();
  expect(await unexpectedPrefetch).toBe(false);
  expect(requests).toEqual([]);
  expect(auditEntries()).toHaveLength(auditBefore);

  await codexLink.click();
  await expect(page).toHaveURL(`${baseURL}/agents/codex`);
  await expect(page.getByRole("region", { name: "Codex status register" })).toContainText(
    "0.145.0",
    { timeout: 30_000 },
  );
  await expect.poll(() => auditEntries().length, { timeout: 30_000 }).toBeGreaterThan(auditBefore);
});

test("gives an explicit scoped URL priority over the remembered panel", async ({
  page,
  context,
}) => {
  await setPanelCookie(context, "hermes");
  await page.goto("/agents/codex/system");

  await expect(page).toHaveURL(`${baseURL}/agents/codex/system`);
  await expect(page).toHaveTitle("System / Codex / Cockpit");
  await expect(page.getByRole("heading", { level: 1, name: "System", exact: true })).toBeVisible();
  await expect(activeAgent(page, "Codex")).toHaveAttribute("aria-current", "location");
  await expectPanelCookie(context, "codex");

  await page.goto("/");
  await expect(page).toHaveURL(`${baseURL}/agents/codex`);
  await expect(
    page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Tasks", exact: true }),
  ).toBeVisible();

  await page.goto("/agents/codex/conversations");
  await expect(page).toHaveTitle("Tasks / Codex / Cockpit");
  await expect(page.getByRole("heading", { level: 1, name: "Tasks", exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "Conversations", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Tasks", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

test("falls back from a stale cookie to the configured Hermes default", async ({
  page,
  context,
}) => {
  await setPanelCookie(context, "removed");
  await page.goto("/");

  await expect(page).toHaveURL(`${baseURL}/agents/hermes`);
  await expect(activeAgent(page, "Hermes")).toHaveAttribute("aria-current", "location");
  await expectPanelCookie(context, "hermes");
});

test("preserves a supported surface and moves focus with a polite switch announcement", async ({
  page,
}) => {
  await page.goto("/agents/hermes/system");
  await activeAgent(page, "Codex").click();

  const codex = activeAgent(page, "Codex");
  await expect(page).toHaveURL(`${baseURL}/agents/codex/system`);
  await expect(codex).toBeFocused();
  await expect(page.locator(".agent-panel-nav + [role='status']")).toHaveText("Now viewing Codex.");
  await expect(page.getByRole("heading", { level: 1, name: "System", exact: true })).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Tasks", exact: true }),
  ).toBeVisible();

  await page.reload();
  await expect(page.locator(".agent-panel-nav + [role='status']")).toBeEmpty();
});

test("does not treat a bookmarked from query as a completed switch", async ({ page }) => {
  await page.goto("/agents/codex/system?from=system");

  await expect(page).toHaveURL(`${baseURL}/agents/codex/system`);
  await expect(activeAgent(page, "Codex")).not.toBeFocused();
  await expect(page.locator(".agent-panel-nav + [role='status']")).toBeEmpty();
});

test("falls back from Hermes Jobs to Codex Overview and explains the change", async ({ page }) => {
  await page.goto("/agents/hermes/jobs");
  await activeAgent(page, "Codex").click();

  const codex = activeAgent(page, "Codex");
  await expect(page).toHaveURL(`${baseURL}/agents/codex`);
  await expect(codex).toBeFocused({ timeout: 30_000 });
  await expect(page.locator(".scope-fallback-notice")).toHaveText(
    "Jobs is not supported by Codex. Opened Overview instead.",
    { timeout: 30_000 },
  );
  await expect(page.locator(".agent-panel-nav + [role='status']")).toHaveText(
    "Now viewing Codex Overview; Jobs is not supported.",
    { timeout: 30_000 },
  );

  await page.reload();
  await expect(page.locator(".scope-fallback-notice")).toHaveCount(0);
  await expect(page.locator(".agent-panel-nav + [role='status']")).toBeEmpty();
});

test("does not commit unsupported or unknown panel routes", async ({ page, context }) => {
  await setPanelCookie(context, "hermes");
  const auditBefore = auditEntries().length;

  const unsupportedResponse = await page.goto("/agents/codex/jobs");
  expect(unsupportedResponse?.status()).toBe(200);
  await expect(page).toHaveTitle("Jobs unsupported / Codex / Cockpit");
  await expect(page.getByRole("heading", { level: 1, name: "Jobs", exact: true })).toBeVisible();
  await expect(
    page.getByText("Unsupported for Codex. No runtime source was read.", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "Jobs", exact: true }),
  ).toHaveCount(0);
  await expectPanelCookie(context, "hermes");
  expect(auditEntries()).toHaveLength(auditBefore);

  await page.goto("/agents/removed");
  await expect(page.getByText("This page could not be found.", { exact: true })).toBeVisible();
  await expectPanelCookie(context, "hermes");
  expect(auditEntries()).toHaveLength(auditBefore);
});

test("keeps existing tabs independent while the last successful navigation guides a new root tab", async ({
  page,
  context,
}) => {
  await page.goto("/agents/hermes/system");
  await expectPanelCookie(context, "hermes");

  const codexTab = await context.newPage();
  await codexTab.goto("/agents/codex/system");
  await expectPanelCookie(context, "codex");
  await expect(page).toHaveURL(`${baseURL}/agents/hermes/system`);
  await expect(codexTab).toHaveURL(`${baseURL}/agents/codex/system`);

  const rootTab = await context.newPage();
  await rootTab.goto("/");
  await expect(rootTab).toHaveURL(`${baseURL}/agents/codex`);
  await expect(page).toHaveURL(`${baseURL}/agents/hermes/system`);
  await expect(codexTab).toHaveURL(`${baseURL}/agents/codex/system`);
});

for (const width of [320, 390]) {
  test(`keeps Agent and primary navigation usable without page overflow at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/agents/hermes");

    const agentNavigation = page.getByRole("navigation", { name: "Agent panels" });
    const primaryNavigation = page.getByRole("navigation", { name: "Primary navigation" });
    await expect(agentNavigation).toBeVisible();
    await expect(primaryNavigation).toBeVisible();

    for (const name of ["Hermes", "Codex"] as const) {
      const link = agentNavigation.getByRole("link", { name: new RegExp(`^${name}`) });
      await expect(link).toBeVisible();
      const box = await link.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    }

    for (const name of ["Overview", "System", "Conversations", "Files", "Jobs"] as const) {
      const link = primaryNavigation.getByRole("link", { name, exact: true });
      await expect(link).toBeVisible();
      const box = await link.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      expect(
        await link.locator("span").evaluate((label) => label.scrollWidth <= label.clientWidth),
      ).toBe(true);
    }

    const widths = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);

    const skipLink = page.getByRole("link", { name: "Skip to content" });
    await skipLink.focus();
    await skipLink.press("Enter");
    const main = page.locator("#main-content");
    await expect(main).toBeFocused();
    const [navigationBox, mainBox] = await Promise.all([
      page.locator(".navigation-rail").boundingBox(),
      main.boundingBox(),
    ]);
    expect(navigationBox).not.toBeNull();
    expect(mainBox).not.toBeNull();
    expect(mainBox!.y).toBeGreaterThanOrEqual(navigationBox!.y + navigationBox!.height - 1);

    if (width === 390) {
      await page.goto("/agents/hermes/system");
      const sourceRows = page.locator(".index-pane .index-row");
      expect(await sourceRows.count()).toBeGreaterThan(1);
      await sourceRows.nth(1).focus();
      await sourceRows.nth(1).press("Enter");
      const previewTitle = page.locator("#system-preview-title");
      await expect(previewTitle).toBeFocused();
      const [navigationBox, titleBox] = await Promise.all([
        page.locator(".navigation-rail").boundingBox(),
        previewTitle.boundingBox(),
      ]);
      expect(navigationBox).not.toBeNull();
      expect(titleBox).not.toBeNull();
      expect(titleBox!.y).toBeGreaterThanOrEqual(navigationBox!.y + navigationBox!.height - 1);
    }
  });
}
