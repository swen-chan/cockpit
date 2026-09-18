import { spawn } from "node:child_process";

const sourceVariables = [
  "COCKPIT_WORKSPACE_ROOT",
  "COCKPIT_SOURCE_PRESET",
  "COCKPIT_SOURCE_MANIFEST",
  "COCKPIT_HERMES_HOME",
  "HERMES_HOME",
  "COCKPIT_PLATFORM_HERMES_ROOT",
  "COCKPIT_CODEX_HOME",
  "COCKPIT_CODEX_WORKSPACE_ROOT",
  "COCKPIT_CODEX_CUSTOM_GUIDANCE",
  "COCKPIT_DEFAULT_PANEL",
  "CODEX_HOME",
  "CODEX_SQLITE_HOME",
];

const clearedSources = Object.fromEntries(sourceVariables.map((name) => [name, ""]));
const child = spawn(process.platform === "win32" ? "pnpm.cmd" : "pnpm", [
  "exec",
  "next",
  "build",
  "--webpack",
], {
  env: {
    ...process.env,
    ...clearedSources,
    COCKPIT_BUILD_SOURCE_READ_GUARD: "1",
  },
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}

child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.once("close", (code) => {
  process.exitCode = typeof code === "number" ? code : 1;
});
