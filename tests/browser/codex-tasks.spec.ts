import { existsSync, readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Codex Tasks browser tests require ${name}.`);
  return value;
}

const auditLog = requiredEnvironment("COCKPIT_E2E_CODEX_AUDIT_LOG");
const forbiddenMarkers = Object.freeze([
  "PRIVATE_CONFIG_SENTINEL",
  "DUPLICATE_MIRROR_SENTINEL",
  "RAW_REASONING_SENTINEL",
  "ENCRYPTED_SENTINEL",
  "PRIVATE_ARGUMENT_SENTINEL",
  "PRIVATE_OUTPUT_SENTINEL",
  "DO_NOT_EXECUTE_SENTINEL",
  "FORBIDDEN_RAW_REASONING_MARKER",
  "FORBIDDEN_RAW_COMMAND_MARKER",
  "FORBIDDEN_RAW_ACTION_MARKER",
  "FORBIDDEN_OLD_PATH",
  "FORBIDDEN_NEW_PATH",
  "FORBIDDEN_PATCH_HEADER",
  "FORBIDDEN_WEB_QUERY_MARKER",
  "FORBIDDEN_WEB_ACTION_MARKER",
  "FORBIDDEN_WEB_RESULT_MARKER",
  "FORBIDDEN_TOOL_NAME_MARKER",
  "FORBIDDEN_TOOL_ARGUMENT_MARKER",
  "synthetic-secret",
]);

function auditEntries(): string[] {
  if (!existsSync(auditLog)) return [];
  const entries = readFileSync(auditLog, "utf8").split("\n").filter(Boolean);
  for (const entry of entries) expect(["version", "app-server"]).toContain(entry);
  return entries;
}

function monitorPage(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const nonLoopbackRequests: string[] = [];
  const responseChecks: Promise<void>[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      ["http:", "https:"].includes(url.protocol) &&
      !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
    ) {
      nonLoopbackRequests.push(request.url());
    }
  });
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (!pathname.startsWith("/api/agents/codex/conversations")) return;
    responseChecks.push(
      response.text().then((body) => {
        for (const marker of forbiddenMarkers) expect(body).not.toContain(marker);
      }),
    );
  });
  return { consoleErrors, nonLoopbackRequests, pageErrors, responseChecks };
}

async function expectNoRuntimeLeaks(
  page: Page,
  monitor: ReturnType<typeof monitorPage>,
): Promise<void> {
  await Promise.all(monitor.responseChecks);
  const body = await page.locator("body").textContent();
  for (const marker of forbiddenMarkers) expect(body).not.toContain(marker);
  expect(monitor.consoleErrors).toEqual([]);
  expect(monitor.pageErrors).toEqual([]);
  expect(monitor.nonLoopbackRequests).toEqual([]);
}

async function expectNoPageOverflow(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
}

test("reads paginated storage through the owned copy with folded Process and no raw payloads", async ({
  page,
}) => {
  const monitor = monitorPage(page);
  await page.goto("/agents/codex/conversations");
  await page.getByRole("button", { name: /App Server integration/u }).click();
  await expect(page.getByText("The synthetic project is ready.", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Inspect the synthetic project.", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Still in progress; refresh later", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Local recorded history only; inherited history is not followed.", {
      exact: true,
    }),
  ).toBeVisible();
  const process = page.locator(".process-disclosure");
  await expect(process).toHaveCount(1);
  await expect(process).not.toHaveAttribute("open", "");
  await process.locator("summary").first().click();
  await expect(process.getByText("Checking the recorded activity.", { exact: true })).toBeVisible();
  await expectNoRuntimeLeaks(page, monitor);
});

test("inspects paginated Codex Tasks and folded Process evidence without eager detail reads", async ({
  page,
}) => {
  const monitor = monitorPage(page);
  const auditBefore = auditEntries().length;
  await page.goto("/agents/codex/conversations");

  await expect(page.getByRole("heading", { level: 1, name: "Tasks", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { level: 2, name: "Select a task" })).toBeVisible({
    timeout: 30_000,
  });
  const rows = page.getByRole("region", { name: "Codex task index" }).getByRole("button");
  await expect(rows).toHaveCount(6);
  expect(auditEntries().slice(auditBefore)).toEqual(["version", "app-server"]);

  const known = page.getByRole("button", { name: /Inspect Cockpit safety/u });
  const unknown = page.getByRole("button", { name: /Unknown project task/u });
  const longProject = page.getByRole("button", { name: /Long project task/u });
  await expect(known).toContainText("PROJECT / cockpit-project");
  await expect(unknown).toContainText("PROJECT / UNKNOWN");
  const longLabel = `project-${"x".repeat(72)}`;
  await expect(longProject).toContainText(`PROJECT / ${longLabel}`);
  expect((await longProject.textContent())?.split(longLabel)).toHaveLength(2);
  await expect(page.getByRole("button", { name: "Show more" })).toBeVisible();

  await page.getByRole("button", { name: "Show more" }).click();
  await expect(page.getByRole("button", { name: /Older CLI task/u })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: /Older App task/u })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Codex task index" }).getByRole("button"),
  ).toHaveCount(7);

  const detailAuditBefore = auditEntries().length;
  await known.click();
  await expect(page.getByText("SAFE_FINAL_ANSWER_MARKER", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  expect(auditEntries().slice(detailAuditBefore)).toEqual(["version", "app-server"]);
  await expect(page.getByText("Completed without a final answer.", { exact: true })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Task metadata" })).toContainText(
    "PROJECT / cockpit-project",
  );

  const disclosures = page.locator(".process-disclosure");
  await expect(disclosures).toHaveCount(2);
  const firstProcess = disclosures.first();
  const firstSummary = firstProcess.locator("summary").first();
  await expect(firstSummary).toHaveAccessibleName("Process, 8 items");
  await expect(firstProcess).not.toHaveAttribute("open", "");
  await expect(firstSummary).not.toHaveAttribute("aria-expanded");
  await expect(firstSummary).toContainText("08");

  const search = page.getByRole("searchbox", { name: "Search loaded task" });
  await search.fill("SAFE_PROGRESS_MARKER");
  await expect(page.locator(".search-count")).toHaveText("0 matches");
  await firstSummary.focus();
  await firstSummary.press("Enter");
  await expect(firstProcess).toHaveAttribute("open", "");
  await expect(page.locator(".search-count")).toHaveText("1 match");
  await expect(firstProcess.locator(".process-row-label")).toHaveText([
    "Progress",
    "Reasoning summary",
    "Plan",
    "Command",
    "Changes",
    "Tool",
    "Tool",
    "Details hidden",
  ]);

  await search.fill("SAFE_OUTPUT_MARKER");
  await expect(page.locator(".search-count")).toHaveText("0 matches");
  const outputSummary = firstProcess.getByText("Output", { exact: true });
  const outputDetails = outputSummary.locator("..");
  await expect(outputDetails).not.toHaveAttribute("open", "");
  await outputSummary.focus();
  await outputSummary.press("Enter");
  await expect(outputDetails).toHaveAttribute("open", "");
  await expect(page.locator(".search-count")).toHaveText("1 match");
  await expect(firstSummary).toContainText("08");

  await search.fill("SAFE_PATCH_MARKER");
  await expect(page.locator(".search-count")).toHaveText("0 matches");
  const patchSummary = firstProcess.getByText("Patch", { exact: true });
  const patchDetails = patchSummary.locator("..");
  await patchSummary.focus();
  await patchSummary.press("Enter");
  await expect(patchDetails).toHaveAttribute("open", "");
  await expect(page.locator(".search-count")).toHaveText("1 match");
  await expect(firstSummary).toContainText("08");

  const secondSummary = disclosures.nth(1).locator("summary").first();
  await expect(secondSummary).toHaveAccessibleName("Process, 1 item");
  await expect(disclosures.nth(1)).not.toHaveAttribute("open", "");
  await expectNoPageOverflow(page);
  await expectNoRuntimeLeaks(page, monitor);
});

for (const width of [320, 390]) {
  test(`keeps Codex Task labels and disclosures usable at ${width}px`, async ({ page }) => {
    const monitor = monitorPage(page);
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/agents/codex/conversations");

    const known = page.getByRole("button", { name: /Inspect Cockpit safety/u });
    const unknown = page.getByRole("button", { name: /Unknown project task/u });
    await expect(known).toContainText("PROJECT / cockpit-project", { timeout: 30_000 });
    await expect(unknown).toContainText("PROJECT / UNKNOWN");
    expect((await known.textContent())?.split("PROJECT /")).toHaveLength(2);
    expect((await unknown.textContent())?.split("PROJECT /")).toHaveLength(2);

    await known.click();
    await expect(page.getByText("SAFE_FINAL_ANSWER_MARKER", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    const title = page.locator("#codex-task-title");
    await expect(title).toBeFocused();
    const processSummary = page.locator(".process-summary").first();
    const processBox = await processSummary.boundingBox();
    expect(processBox).not.toBeNull();
    expect(processBox!.height).toBeGreaterThanOrEqual(44);

    const [navigationBox, titleBox] = await Promise.all([
      page.locator(".navigation-rail").boundingBox(),
      title.boundingBox(),
    ]);
    expect(navigationBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    expect(titleBox!.y).toBeGreaterThanOrEqual(navigationBox!.y + navigationBox!.height - 1);
    await expectNoPageOverflow(page);
    await expectNoRuntimeLeaks(page, monitor);
  });
}
