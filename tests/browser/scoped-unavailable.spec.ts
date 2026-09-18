import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

const cookieName = "cockpit_last_panel";
function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Unavailable browser tests require ${name}.`);
  return value;
}
const baseURL = requiredEnvironment("COCKPIT_E2E_BASE_URL");
const auditLog = requiredEnvironment("COCKPIT_E2E_CODEX_AUDIT_LOG");

test("keeps a remembered unavailable Codex panel selected and renders a bounded failure", async ({
  page,
  context,
}) => {
  await context.addCookies([{ name: cookieName, value: "codex", url: baseURL }]);
  await page.goto("/");

  await expect(page).toHaveURL(`${baseURL}/agents/codex`);
  await expect(page).toHaveTitle("Overview / Codex / Cockpit");
  await expect(
    page.getByRole("heading", { level: 1, name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Agent panels" }).getByRole("link", { name: /^Codex/ }),
  ).toHaveAttribute("aria-current", "location");
  const runtimeSection = page.locator(".overview-grid > section").filter({
    has: page.getByRole("heading", { level: 2, name: "Runtime", exact: true }),
  });
  await expect(runtimeSection.locator(".source-state[role='alert']")).toContainText(
    "The selected Agent runtime version is not supported.",
  );
  await expect(page.getByText("0.153.4", { exact: false })).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await context.cookies(baseURL)).find((cookie) => cookie.name === cookieName)?.value,
    )
    .toBe("codex");

  const entries = readFileSync(auditLog, "utf8").split("\n").filter(Boolean);
  expect(entries.length).toBeGreaterThan(0);
  expect(new Set(entries)).toEqual(new Set(["version"]));
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page
    .getByRole("navigation", { name: "Agent panels" })
    .getByRole("link", { name: /^Hermes/ })
    .click();
  await expect(page).toHaveURL(`${baseURL}/agents/hermes`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Overview", exact: true }),
  ).toBeVisible();
});
