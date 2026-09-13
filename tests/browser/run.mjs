import { spawn } from "node:child_process";

import {
  assertHermesFixtureSourcesUnchanged,
  createHermesFixture,
  removeHermesFixture,
  snapshotHermesFixtureSources,
} from "../helpers/hermes-fixture.ts";

const forwardedArguments = process.argv.slice(2);
if (forwardedArguments[0] === "--") forwardedArguments.shift();

let child;
let fixture;
let interruptedSignal;
let exitCode = 1;
let sourceSnapshot;

try {
  fixture = createHermesFixture("cockpit-browser-");
  sourceSnapshot = snapshotHermesFixtureSources(fixture);
  child = spawn(process.platform === "win32" ? "pnpm.cmd" : "pnpm", [
    "exec",
    "playwright",
    "test",
    ...forwardedArguments,
  ], {
    env: {
      ...process.env,
      ...fixture.environment,
      COCKPIT_E2E_SYNTHETIC: "1",
    },
    stdio: "inherit",
  });

  const forwardSignal = (signal) => {
    interruptedSignal = signal;
    if (child && !child.killed) child.kill(signal);
  };
  process.once("SIGINT", () => forwardSignal("SIGINT"));
  process.once("SIGTERM", () => forwardSignal("SIGTERM"));

  exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (typeof code === "number") resolve(code);
      else resolve(signal || interruptedSignal ? 1 : 0);
    });
  });
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  if (fixture) {
    try {
      if (sourceSnapshot) assertHermesFixtureSourcesUnchanged(sourceSnapshot);
    } catch (error) {
      console.error(error);
      exitCode = 1;
    } finally {
      removeHermesFixture(fixture);
    }
  }
}

process.exitCode = exitCode;
