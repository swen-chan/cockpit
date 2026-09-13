import { expect, test, type Page } from "@playwright/test";

import {
  forbiddenHermesFixtureMarkers,
  privateHermesFixturePersistenceMarkers,
} from "../helpers/hermes-fixture";

const routes = [
  { href: "/", title: "Overview" },
  { href: "/system", title: "System" },
  { href: "/conversations", title: "Conversations" },
  { href: "/files", title: "Files" },
  { href: "/jobs", title: "Jobs" },
] as const;

interface SafetyObservation {
  consoleErrors: string[];
  externalRequests: string[];
  pageErrors: string[];
  renderedHtml: string[];
  responseBodies: Array<Promise<{
    body?: string;
    error?: string;
    url: string;
  }>>;
}

function isLoopbackHttpUrl(value: string): boolean {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") return true;
  return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
}

function observeSafety(page: Page): SafetyObservation {
  const observation: SafetyObservation = {
    consoleErrors: [],
    externalRequests: [],
    pageErrors: [],
    renderedHtml: [],
    responseBodies: [],
  };

  page.on("console", (message) => {
    if (message.type() === "error") observation.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => observation.pageErrors.push(error.message));
  page.on("request", (request) => {
    if (!isLoopbackHttpUrl(request.url())) observation.externalRequests.push(request.url());
  });
  page.on("response", (response) => {
    if (!["document", "fetch", "xhr"].includes(response.request().resourceType())) return;
    observation.responseBodies.push(
      response.text()
        .then((body) => ({ body, url: response.url() }))
        .catch((error: unknown) => ({
          error: error instanceof Error ? error.message : "Unknown response body read failure",
          url: response.url(),
        })),
    );
  });

  return observation;
}

async function expectSafeBrowserState(page: Page, observation: SafetyObservation): Promise<void> {
  const [html, responses] = await Promise.all([
    page.content(),
    Promise.all(observation.responseBodies),
  ]);
  const renderedHtml = [...observation.renderedHtml, html];
  const leaks: string[] = [];
  const responseReadErrors = responses
    .filter((response) => response.error && !new URL(response.url).searchParams.has("_rsc"))
    .map((response) => `${response.url}: ${response.error}`);

  for (const marker of [
    ...forbiddenHermesFixtureMarkers,
    ...privateHermesFixturePersistenceMarkers,
  ]) {
    for (const snapshot of renderedHtml) {
      if (snapshot.includes(marker)) leaks.push(`${marker} in rendered HTML`);
    }
    for (const response of responses) {
      if (response.body?.includes(marker)) leaks.push(`${marker} in ${response.url}`);
    }
  }

  expect(observation.consoleErrors, "browser console errors").toEqual([]);
  expect(observation.pageErrors, "uncaught browser errors").toEqual([]);
  expect(observation.externalRequests, "non-loopback HTTP(S) requests").toEqual([]);
  expect(responseReadErrors, "unreadable non-RSC browser responses").toEqual([]);
  expect(leaks, "raw synthetic secret markers in browser-visible responses").toEqual([]);
}

let safetyObservation: SafetyObservation;

test.beforeEach(async ({ page }) => {
  safetyObservation = observeSafety(page);
});

test.afterEach(async ({ page }) => {
  await expectSafeBrowserState(page, safetyObservation);
});

test("navigates all five read-only surfaces and exposes the Overview destinations", async ({ page }) => {
  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  const overview = page.locator(".overview-grid");

  for (const { href, title } of routes.slice(1)) {
    const link = overview.getByRole("link", { name: title, exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", href);
  }

  for (const { href, title } of routes) {
    if (href !== "/") {
      await navigation.getByRole("link", { name: title, exact: true }).click();
      await expect(page).toHaveURL(href);
    }

    await expect(page.getByText("READ ONLY", { exact: true })).toBeVisible();
    await expect(page.locator(".page-header").getByRole("heading", { level: 1, name: title, exact: true })).toHaveCount(1);
    await expect(navigation.getByRole("link", { name: title, exact: true })).toHaveAttribute("aria-current", "page");
    safetyObservation.renderedHtml.push(await page.content());
  }
});

test("selects and searches a System document", async ({ page }) => {
  await page.goto("/system");
  const memory = page.getByRole("button", { name: /Memory.*Durable context/is });

  await memory.focus();
  await memory.press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: "Memory", exact: true })).toBeVisible();

  const search = page.getByRole("searchbox", { name: "Search this document" });
  await search.fill("durable-browser-marker");
  await expect(page.locator(".search-count")).toHaveText("1 match");
  await expect(page.locator("mark").filter({ hasText: "durable-browser-marker" })).toBeVisible();

  await page.getByRole("button", { name: /Skills.*Capabilities/is }).click();
  await page.getByRole("searchbox", { name: "Filter skills" }).fill("research");
  await page.getByRole("button", { name: /fixture-skill/i }).click();

  const skillPreview = page.getByRole("region", { name: "fixture-skill preview" });
  await expect(skillPreview).toContainText("bounded-skill-marker");
  await expect(skillPreview.locator("script, img, iframe, style, object, embed, a")).toHaveCount(0);
  expect(await page.evaluate(() => "__cockpitSkillExecuted" in window)).toBe(false);

  await page.getByRole("searchbox", { name: "Search selected skill" }).fill("bounded-skill-marker");
  await expect(skillPreview.locator("mark").filter({ hasText: "bounded-skill-marker" })).toBeVisible();
});

test("paginates, selects, and searches Conversations at a narrow width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/conversations");
  const conversationRegion = page.getByRole("region", { name: "Eligible conversations" });

  await expect(conversationRegion.locator(".conversation-row")).toHaveCount(5);
  await conversationRegion.getByRole("button", { name: "Show more" }).click();
  await expect(conversationRegion.locator(".conversation-row")).toHaveCount(6);
  await expect(conversationRegion.getByText("All 6 eligible sessions are loaded.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Synthetic conversation 6/i }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Synthetic conversation 6", exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search loaded transcript" }).fill("sixth-transcript-marker");
  await expect(page.locator(".search-count")).toHaveText("1 match");
  await expect(page.locator("mark").filter({ hasText: "sixth-transcript-marker" })).toBeVisible();
});

test("navigates, searches, and distinguishes file states at a narrow width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/files");

  await page.getByRole("button", { name: /nested.*Directory/is }).click();
  await expect(page.getByLabel("Current workspace directory nested")).toBeVisible();
  await page.getByRole("button", { name: /notes\.md.*Markdown/is }).click();
  await expect(page.getByRole("heading", { level: 2, name: "notes.md", exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search this file" }).fill("nested-file-marker");
  await expect(page.locator(".search-count")).toHaveText("1 match");
  await expect(page.locator("mark").filter({ hasText: "nested-file-marker" })).toBeVisible();

  await page.getByRole("button", { name: "Parent directory" }).click();
  await page.getByRole("button", { name: /empty.*Directory/is }).click();
  await expect(page.getByText("The approved directory contains no visible entries.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Parent directory" }).click();
  await page.getByRole("button", { name: /manual\.pdf.*PDF document/is }).click();
  await expect(page.getByRole("heading", { level: 3, name: "Preview not available", exact: true })).toBeVisible();
});

test("selects the second Job and keeps table overflow inside its region", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/jobs");
  const tableRegion = page.getByRole("region", { name: "Scheduled jobs table" });

  await page.getByRole("button", { name: "Synthetic job 2", exact: true }).click();
  await expect(page.getByRole("region", { name: "Synthetic job 2 details" })).toBeFocused();
  expect(await tableRegion.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
