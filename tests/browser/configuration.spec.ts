import { expect, test } from "@playwright/test";

const invalid = process.env.COCKPIT_E2E_SCENARIO === "invalid-config";
const heading = invalid ? "Invalid Agent configuration" : "No Agent configured";

test("shows actionable configuration guidance without loading an Agent", async ({ page }) => {
  const sourceRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/agents/"))
      sourceRequests.push(request.url());
  });

  for (const route of ["/", "/agents/hermes"]) {
    await page.goto(route);
    await expect(page).toHaveURL(route);
    await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary navigation" })).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Read the configuration guide", exact: true }),
    ).toHaveAttribute("href", "https://github.com/swen-chan/cockpit#choose-your-local-sources");
    await expect(page.locator("body")).not.toContainText("PRIVATE_INVALID_WORKSPACE_MARKER");
  }
  expect(sourceRequests).toEqual([]);
});

test("returns a bounded private API failure for the unavailable configuration", async ({
  request,
}) => {
  const response = await request.get("/api/agents/hermes/overview");
  expect(response.status()).toBe(503);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(await response.json()).toMatchObject({
    code: invalid ? "source_malformed" : "missing_source",
    message: invalid
      ? "The local source could not be safely interpreted."
      : "The requested local source is unavailable.",
  });
  expect(await response.text()).not.toContain("PRIVATE_INVALID_WORKSPACE_MARKER");
});
