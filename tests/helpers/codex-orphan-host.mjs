// Manual acceptance host. Private IPC is control only; stdout/stderr are never logged.
// fd 4/5 belong to the surviving launcher, so killing this host closes only child stdin.
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { assertOwnedTempDirectory } from "../../src/server/codex/owned-temp.mjs";
import { sterileEnvironment } from "../../src/server/codex/owned-process.mjs";

const worker = fileURLToPath(
  new URL("../../src/server/codex/snapshot-worker.mjs", import.meta.url),
);
const POLICY = "(version 1) (allow default) (deny network-outbound)";
const APP_ARGS = [
  "app-server",
  "--listen",
  "stdio://",
  "--strict-config",
  "--disable",
  "plugins",
  "--disable",
  "remote_plugin",
  "--disable",
  "apps",
  "-c",
  "analytics.enabled=false",
  "-c",
  "check_for_update_on_startup=false",
];
const INITIALIZE = {
  id: 1,
  method: "initialize",
  params: {
    clientInfo: { name: "cockpit", title: "Cockpit", version: "0.2.0" },
    capabilities: {
      experimentalApi: false,
      requestAttestation: false,
      mcpServerOpenaiFormElicitation: false,
      optOutNotificationMethods: ["remoteControl/status/changed"],
    },
  },
};

let child;
let kind;
let state = "configuration";
const hardDeadline = setTimeout(() => {
  child?.stdin.destroy();
  if (Number.isInteger(child?.pid)) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  }
  process.exit(1);
}, 15000);

function notify(message) {
  if (!process.send || !process.connected) return;
  process.send(message, () => {});
}

function failed() {
  notify({ type: "failed" });
  child?.stdin.destroy();
}

process.on("uncaughtException", failed);
process.on("unhandledRejection", failed);
process.on("disconnect", () => {
  child?.stdin.destroy();
  clearTimeout(hardDeadline);
  process.exit(1);
});

process.on("message", async (message) => {
  try {
    if (state === "configuration" && message?.type === "configuration") {
      if (
        process.platform !== "darwin" ||
        typeof process.geteuid !== "function" ||
        process.geteuid() === 0 ||
        !["app-server", "snapshot-helper"].includes(message.kind) ||
        typeof message.executable !== "string" ||
        !path.isAbsolute(message.executable)
      )
        throw new Error();
      const home = process.env.HOME;
      assertOwnedTempDirectory(home);
      if ((await fs.realpath(home)) !== home) throw new Error();
      kind = message.kind;
      const executable =
        kind === "app-server"
          ? await fs.realpath(message.executable)
          : await fs.realpath(process.execPath);
      const identity = await fs.stat(executable, { bigint: true });
      if (!identity.isFile()) throw new Error();
      const args = kind === "app-server" ? APP_ARGS : ["--conditions=react-server", worker];
      state = "ownership";
      child = spawn("/usr/bin/sandbox-exec", ["-p", POLICY, executable, ...args], {
        cwd: home,
        env: sterileEnvironment(home, kind === "app-server"),
        shell: false,
        detached: true,
        stdio: ["pipe", 4, 5],
      });
      if (!Number.isInteger(child.pid)) throw new Error();
      child.once("error", failed);
      child.stdin.on("error", failed);
      notify({
        type: "childSpawned",
        record: {
          pid: child.pid,
          pgid: child.pid,
          executableIdentity: `${identity.dev}:${identity.ino}:${identity.size}`,
          startToken: String(performance.now()),
        },
      });
    } else if (state === "ownership" && message?.type === "ownershipAccepted") {
      if (kind === "snapshot-helper") {
        state = "ready";
        notify({ type: "ready" }); // Deliberately send no worker input.
      } else {
        state = "initialize";
        child.stdin.write(`${JSON.stringify(INITIALIZE)}\n`);
      }
    } else if (state === "initialize" && message?.type === "initializeAccepted") {
      state = "ready";
      child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`, () =>
        notify({ type: "ready" }),
      );
    } else if (state === "ready" && kind === "snapshot-helper" && message?.type === "startBackup") {
      const input = message.input;
      const home = process.env.HOME;
      const base = path.dirname(path.dirname(home));
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.keys(input).length !== 3 ||
        ![128, 256].some(
          (size) => input.sourceDatabase === path.join(base, `source-${size}`, "state_5.sqlite"),
        ) ||
        input.destinationDatabase !== path.join(home, "state_5.sqlite") ||
        input.placeholder !== path.join(home, "list-placeholder.jsonl") ||
        Buffer.byteLength(JSON.stringify(input)) + 1 > 4096
      )
        throw new Error();
      state = "activeBackup";
      child.stdin.write(`${JSON.stringify(input)}\n`, () => notify({ type: "backupStarted" }));
    } else {
      failed();
    }
  } catch {
    failed();
  }
});
