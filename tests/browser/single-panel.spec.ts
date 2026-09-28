import { expect, test } from "@playwright/test";

const panelId = process.env.COCKPIT_E2E_SCENARIO === "codex-only" ? "codex" : "hermes";
const panelName = panelId === "codex" ? "Codex" : "Hermes";
const otherPanelId = panelId === "codex" ? "hermes" : "codex";
const baseURL = process.env.COCKPIT_E2E_BASE_URL;
if (!baseURL) throw new Error("Single-panel browser tests require COCKPIT_E2E_BASE_URL.");

test("opens the sole configured panel at its scoped URL and replaces a stale selection", async ({
  page,
  context,
}) => {
  await context.addCookies([{ name: "cockpit_last_panel", value: otherPanelId, url: baseURL }]);
  await page.goto("/");

  await expect(page).toHaveURL(`${baseURL}/agents/${panelId}`);
  await expect(page).toHaveTitle(`Overview / ${panelName} / Cockpit`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".product-mark")).toContainText(`/ ${panelName.toUpperCase()}`);
  await expect(page.getByRole("navigation", { name: "Agent panels" })).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await context.cookies(baseURL)).find((cookie) => cookie.name === "cockpit_last_panel")
          ?.value,
    )
    .toBe(panelId);

  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  for (const link of await navigation.getByRole("link").all()) {
    expect(await link.getAttribute("href")).toMatch(new RegExp(`^/agents/${panelId}(?:/|$)`));
  }
  const conversations = navigation.getByRole("link", {
    name: panelId === "codex" ? "Tasks" : "Conversations",
    exact: true,
  });
  await conversations.click();
  await expect(page).toHaveURL(`${baseURL}/agents/${panelId}/conversations`);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: panelId === "codex" ? "Tasks" : "Conversations",
      exact: true,
    }),
  ).toBeVisible();
  const firstEntry = page.getByRole("button", {
    name: panelId === "codex" ? /Inspect Cockpit safety/u : /Synthetic conversation 1/u,
  });
  await expect(firstEntry).toBeVisible({ timeout: 30_000 });
  await firstEntry.click();
  await expect(
    page.getByText(panelId === "codex" ? "SAFE_FINAL_ANSWER_MARKER" : "Synthetic answer 1", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 30_000 });

  await page.goto(`/agents/${otherPanelId}`);
  await expect(page.getByText("This page could not be found.", { exact: true })).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveURL(`${baseURL}/agents/${panelId}`);
});
