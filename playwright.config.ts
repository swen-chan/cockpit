import { defineConfig, devices } from "@playwright/test";

const scenario = process.env.COCKPIT_E2E_SCENARIO ?? "legacy-ready";
const scenarioTests: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "legacy-ready": Object.freeze([
    "http-security.spec.ts",
    "surfaces.spec.ts",
    "task12-usability.spec.ts",
  ]),
  "dual-ready": Object.freeze([
    "scoped-navigation.spec.ts",
    "codex-tasks.spec.ts",
    "codex-surfaces.spec.ts",
  ]),
  "dual-codex-unavailable": Object.freeze(["scoped-unavailable.spec.ts"]),
});
const scenarioMatch = scenarioTests[scenario];
if (!scenarioMatch) throw new Error(`Unknown synthetic browser scenario: ${scenario}`);
const testMatch = [...scenarioMatch];

const baseURL = process.env.COCKPIT_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const webServerCommand =
  process.env.COCKPIT_E2E_WEB_COMMAND ?? (process.env.CI ? "pnpm start" : "pnpm dev");

export default defineConfig({
  testDir: "./tests/browser",
  testMatch,
  fullyParallel: false,
  failOnFlakyTests: Boolean(process.env.CI),
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: webServerCommand,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
