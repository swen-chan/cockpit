#!/usr/bin/env node
// Test-only Codex stdio peer. It never discovers Codex data or uses the network.
// Write { mode, stage } to HOME/fixture-mode.json to select an injected failure.
// Optional synthetic initializeResult/listResult/readResult overrides are wire
// fixtures, not production configuration. Child workers share the parent's PGID.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const MiB = 1024 * 1024;
const home = process.env.HOME;
if (!home || !path.isAbsolute(home)) process.exit(2);

let fixture = {};
try {
  const file = path.join(home, "fixture-mode.json");
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 64 * 1024) process.exit(2);
  fixture = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!fixture || typeof fixture !== "object" || Array.isArray(fixture)) process.exit(2);
} catch (error) {
  if (error.code !== "ENOENT") process.exit(2);
}

const mode = fixture.mode ?? "success";
const operationModes = new Set([
  "wrong-thread-id",
  "excluded-source",
  "descendant-hang",
  "descendant-rss",
  "eof-hang",
  "delayed-success",
]);
const stage = fixture.stage ?? (operationModes.has(mode) ? "operation" : "initialize");
let holdOpen = false;
let keepAlive;
let allocation;
let worker;
let state = "initialize";
let pending = "";
let inbound = Promise.resolve();

// The controller may kill the owned group while a deliberately large write is
// in flight. EPIPE is expected test teardown, not an unhandled stderr diagnostic.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", () => process.exit(0));
}

function write(stream, value) {
  return new Promise((resolve) => stream.write(value, resolve));
}

function send(value) {
  return write(process.stdout, `${JSON.stringify(value)}\n`);
}

function remainAlive() {
  holdOpen = true;
  keepAlive ??= setInterval(() => {
    if (allocation?.length) allocation[0] ^= 1;
  }, 1000);
}

function observe(request) {
  if (fixture.recordRequests === true) {
    fs.appendFileSync(
      path.join(home, "fixture-observations.jsonl"),
      `${JSON.stringify({ method: request.method, id: request.id ?? null, params: request.params ?? null })}\n`,
      { mode: 0o600 },
    );
  }
}

function startWorker({ rssBytes = 0, inheritPipes = true } = {}) {
  const code = `
    const memory = Buffer.alloc(${rssBytes}, 0x5a);
    setInterval(() => { if (memory.length) memory[0] ^= 1; }, 1000);
    process.on("SIGTERM", () => {});
  `;
  worker = spawn(process.execPath, ["-e", code], {
    shell: false,
    detached: false,
    cwd: home,
    env: {
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      HOME: home,
      TMPDIR: process.env.TMPDIR ?? home,
      LANG: "C",
      LC_ALL: "C",
    },
    stdio: inheritPipes ? ["ignore", "inherit", "inherit"] : "ignore",
  });
  worker.on("error", () => process.exit(2));
  worker.unref();
}

function initializeResult() {
  const mac = process.platform === "darwin";
  const result = fixture.initializeResult ?? {
    codexHome: process.env.CODEX_HOME ?? home,
    platformFamily: "unix",
    platformOs: mac ? "macos" : "linux",
    userAgent: `cockpit/0.145.0 (${mac ? "Mac OS" : "Linux"} ${os.release()}; ${process.arch}) dumb (cockpit; 0.2.0)`,
  };
  if (mode === "wrong-home") return { ...result, codexHome: "/synthetic/wrong-home" };
  if (mode === "wrong-platform")
    return { ...result, platformFamily: "windows", platformOs: "windows" };
  if (mode === "wrong-user-agent")
    return { ...result, userAgent: "cockpit/0.153.4 (Synthetic; synthetic)" };
  return result;
}

function thread(id, withTurns) {
  return {
    id,
    sessionId: id,
    preview: "Synthetic Codex question",
    ephemeral: false,
    modelProvider: "synthetic",
    createdAt: 1700000000,
    updatedAt: 1700000001,
    status: { type: "idle" },
    path: path.join(home, "sessions", "synthetic.jsonl"),
    cwd: path.join(home, "workspace", "synthetic-project"),
    cliVersion: "0.145.0",
    source: "cli",
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: "Synthetic task",
    turns: withTurns
      ? [
          {
            id: "synthetic-turn",
            status: "completed",
            error: null,
            itemsView: "full",
            items: [
              {
                type: "userMessage",
                id: "synthetic-user",
                content: [{ type: "text", text: "Synthetic question", text_elements: [] }],
              },
              {
                type: "agentMessage",
                id: "synthetic-answer",
                text: "Synthetic final answer",
                phase: "final_answer",
              },
            ],
          },
        ]
      : [],
  };
}

function operationResult(request) {
  if (request.method === "thread/list") {
    const cursor =
      typeof request.params?.cursor === "string" ? request.params.cursor : "__initial__";
    if (
      fixture.listResultsByCursor &&
      typeof fixture.listResultsByCursor === "object" &&
      !Array.isArray(fixture.listResultsByCursor) &&
      Object.hasOwn(fixture.listResultsByCursor, cursor)
    ) {
      return fixture.listResultsByCursor[cursor];
    }
    return fixture.listResult ?? { data: [thread("synthetic-thread", false)], nextCursor: null };
  }
  const id = mode === "wrong-thread-id" ? "synthetic-wrong-thread" : request.params?.threadId;
  const mapped =
    typeof id === "string" &&
    fixture.readResultsById &&
    typeof fixture.readResultsById === "object" &&
    !Array.isArray(fixture.readResultsById) &&
    Object.hasOwn(fixture.readResultsById, id)
      ? fixture.readResultsById[id]
      : undefined;
  const result = mapped ?? fixture.readResult ?? { thread: thread(id ?? "synthetic-thread", true) };
  if (mode === "excluded-source")
    return { ...result, thread: { ...result.thread, source: "exec" } };
  return result;
}

async function inject(id, result, atStage) {
  if (stage !== atStage || mode === "success") return false;
  switch (mode) {
    case "wrong-id":
      await send({ id: 999, result });
      break;
    case "string-id":
      await send({ id: String(id), result });
      break;
    case "missing-id":
      await send({ result });
      break;
    case "stale-id":
      await send({ id: id === 2 ? 1 : 2, result });
      break;
    case "duplicate-id":
      await write(
        process.stdout,
        `${JSON.stringify({ id, result })}\n${JSON.stringify({ id, result })}\n`,
      );
      break;
    case "both-result-error":
      await send({
        id,
        result,
        error: { code: -32000, message: "SYNTHETIC_PRIVATE_ERROR_MARKER" },
      });
      break;
    case "remote-error":
      await send({ id, error: { code: -32000, message: "SYNTHETIC_PRIVATE_ERROR_MARKER" } });
      break;
    case "server-request":
      await send({
        id: 71,
        method: "item/commandExecution/requestApproval",
        params: { marker: "SYNTHETIC_PRIVATE_REQUEST_MARKER" },
      });
      break;
    case "server-request-zero-id":
    case "server-request-null-id":
      await send({
        id: mode === "server-request-zero-id" ? 0 : null,
        method: "item/commandExecution/requestApproval",
        params: null,
      });
      break;
    case "unknown-notification":
      await send({
        method: "synthetic/unrecognized",
        params: { marker: "SYNTHETIC_PRIVATE_NOTIFICATION_MARKER" },
      });
      break;
    case "allowed-notification":
    case "four-notifications":
    case "notification-overflow": {
      const count = mode === "allowed-notification" ? 1 : mode === "four-notifications" ? 4 : 5;
      for (let index = 0; index < count; index += 1) {
        await send({
          method: "remoteControl/status/changed",
          params: { marker: "SYNTHETIC_PRIVATE_NOTIFICATION_MARKER", index },
        });
      }
      await send({ id, result });
      break;
    }
    case "invalid-json":
      await write(process.stdout, "{invalid-json}\n");
      break;
    case "invalid-utf8":
      await write(process.stdout, Buffer.from([0xc3, 0x28, 0x0a]));
      break;
    case "truncated-line":
      await write(process.stdout, `{"id":${id},"result":`);
      process.exit(0);
      break;
    case "oversize-line":
      await write(process.stdout, "x".repeat(16 * MiB + 1));
      break;
    case "stdout-overflow": {
      // Each line is below 16 MiB and each allowed notification is ignored;
      // together they exceed 17 MiB before any response can complete the call.
      const params = { padding: "x".repeat(9 * MiB) };
      await send({ method: "remoteControl/status/changed", params });
      await send({ method: "remoteControl/status/changed", params });
      break;
    }
    case "stderr-overflow":
      await write(process.stderr, "x".repeat(64 * 1024 + 1));
      break;
    case "message-overflow":
      // With a four-notification allowance the notification cap can fire
      // first; this still proves no message flood is accepted indefinitely.
      for (let index = 0; index < 17; index += 1)
        await send({ method: "remoteControl/status/changed", params: null });
      break;
    case "hang":
      remainAlive();
      return true;
    case "early-exit":
      process.exit(0);
      break;
    case "descendant-hang":
      startWorker();
      await send({ id, result });
      break;
    case "rss": {
      const bytes = Number.isSafeInteger(fixture.rssBytes) ? fixture.rssBytes : 448 * MiB;
      if (bytes < 0 || bytes > 512 * MiB) process.exit(2);
      allocation = Buffer.alloc(bytes, 0x5a);
      remainAlive();
      return true;
    }
    case "descendant-rss":
      allocation = Buffer.alloc(224 * MiB, 0x5a);
      startWorker({ rssBytes: 224 * MiB, inheritPipes: false });
      remainAlive();
      return true;
    case "eof-hang":
      remainAlive();
      await send({ id, result });
      break;
    case "delayed-success": {
      const ms = fixture.delayMs ?? 350;
      if (!Number.isSafeInteger(ms) || ms < 0 || ms > 1000) process.exit(2);
      await new Promise((resolve) => setTimeout(resolve, ms));
      await send({ id, result });
      break;
    }
    case "wrong-home":
    case "wrong-platform":
    case "wrong-user-agent":
    case "wrong-thread-id":
    case "excluded-source":
      await send({ id, result });
      break;
    default:
      process.exit(2);
  }
  return true;
}

if (process.argv[2] === "--version") {
  if (mode === "version-hang") remainAlive();
  else if (mode === "version-early-exit") process.exit(0);
  else if (mode === "version-overflow") await write(process.stdout, "x".repeat(4097));
  else if (mode === "version-combined-overflow") {
    const header = "codex-cli 0.145.0\n";
    // Preserve an otherwise exact version stdout. Each stream is below 4 KiB,
    // while their aggregate is 4097 bytes; stderr precedes completion's newline.
    await write(process.stderr, "x".repeat(4097 - header.length));
    await write(process.stdout, header);
  } else
    await write(
      process.stdout,
      `${mode === "wrong-version" ? "codex-cli 0.153.4" : "codex-cli 0.145.0"}\n`,
    );
  if (!holdOpen) process.exit(0);
} else if (process.argv[2] !== "app-server") {
  process.exit(2);
} else {
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    pending += chunk;
    if (pending.length > 64 * 1024) process.exit(2);
    let end;
    while ((end = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      inbound = inbound
        .then(async () => {
          const request = JSON.parse(line);
          observe(request);
          if (state === "initialize" && request.method === "initialize" && request.id === 1) {
            state = "initialized";
            const result = initializeResult();
            if (!(await inject(1, result, "initialize"))) await send({ id: 1, result });
          } else if (
            state === "initialized" &&
            request.method === "initialized" &&
            !Object.hasOwn(request, "id")
          ) {
            state = "operation";
          } else if (
            state === "operation" &&
            request.id === 2 &&
            ["thread/list", "thread/read"].includes(request.method)
          ) {
            state = "complete";
            const result = operationResult(request);
            if (!(await inject(2, result, "operation"))) await send({ id: 2, result });
          } else {
            process.exit(2);
          }
        })
        .catch(() => process.exit(2));
    }
  });
  process.stdin.on("end", () => {
    inbound.finally(() => {
      if (!holdOpen) process.exit(0);
    });
  });
  process.stdin.on("error", () => {
    if (!holdOpen) process.exit(0);
  });
}
