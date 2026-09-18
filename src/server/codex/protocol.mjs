import "server-only";

import { CODEX_LIMITS as limits } from "./limits.mjs";
import { runOwnedProcess } from "./owned-process.mjs";

const fail = (code) => Object.assign(new Error(code), { code });
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const sources = new Set(["cli", "vscode", "appServer"]);
const APP_ARGS = Object.freeze([
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
]);
const INITIALIZE = Object.freeze({
  clientInfo: { name: "cockpit", title: "Cockpit", version: "0.2.0" },
  capabilities: {
    experimentalApi: false,
    requestAttestation: false,
    mcpServerOpenaiFormElicitation: false,
    optOutNotificationMethods: ["remoteControl/status/changed"],
  },
});
const VERSION_LINE = /^codex-cli \d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\n$/;

function classifyVersion(output) {
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(output);
  if (decoded === `codex-cli ${limits.version}\n`) return limits.version;
  if (VERSION_LINE.test(decoded)) throw fail("unsupported_runtime_version");
  throw fail("protocol_violation");
}

// argvPrefix and sampling injection are private synthetic-test seams, never route inputs.
export async function probeVersion({ command, argvPrefix = [], home, owner, signal, sampleGroup }) {
  let output = Buffer.alloc(0);
  const response = await runOwnedProcess({
    command,
    args: [...argvPrefix, "--version"],
    home,
    app: true,
    owner,
    signal,
    sampleGroup,
    lifetimeMs: limits.probeMs,
    stdoutCap: limits.probeBytes,
    stderrCap: limits.probeBytes,
    combinedCap: limits.probeBytes,
    onStart() {},
    onData(bytes, api) {
      output = Buffer.concat([output, bytes]);
      if (output.includes(10)) api.complete(classifyVersion(output));
    },
    onEnd() {
      classifyVersion(output);
    },
  });
  return { version: response.value, metrics: response.metrics };
}

function validateInitialize(value, home) {
  const os = process.platform === "darwin" ? "macos" : "linux";
  const ua =
    process.platform === "darwin"
      ? /^cockpit\/0\.145\.0 \(Mac OS [0-9]+(?:\.[0-9]+)*; (?:arm64|x86_64)\) dumb \(cockpit; 0\.2\.0\)$/
      : // Upstream os_info supplies the Linux distribution name, not always "Linux".
        /^cockpit\/0\.145\.0 \([A-Za-z][A-Za-z ._-]{0,48} [0-9A-Za-z._+-]{1,64}; (?:aarch64|arm64|x86_64|x64)\) dumb \(cockpit; 0\.2\.0\)$/;
  if (
    !object(value) ||
    value.codexHome !== home ||
    value.platformFamily !== "unix" ||
    value.platformOs !== os ||
    typeof value.userAgent !== "string" ||
    !ua.test(value.userAgent)
  )
    throw fail("protocol_violation");
}

export async function exchangeAppServer({
  command,
  argvPrefix = [],
  home,
  kind,
  taskId,
  copiedRowExists,
  cursor = null,
  owner,
  signal,
  sampleGroup,
}) {
  if (kind !== "list" && kind !== "read") throw fail("protocol_violation");
  if (
    kind === "read" &&
    (typeof taskId !== "string" || !taskId || taskId.length > 128 || copiedRowExists !== true)
  )
    throw fail("protocol_violation");
  if (cursor !== null && (typeof cursor !== "string" || cursor.length > 4096))
    throw fail("protocol_violation");
  let pending = Buffer.alloc(0);
  let messages = 0;
  let notifications = 0;
  let state = "initialize";
  function accept(line, api) {
    if (++messages > limits.messages) throw fail("protocol_violation");
    const message = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line));
    if (!object(message)) throw fail("protocol_violation");
    if (own(message, "method")) {
      if (
        own(message, "id") ||
        message.method !== "remoteControl/status/changed" ||
        !own(message, "params") ||
        ++notifications > limits.notifications ||
        Object.keys(message).some((key) => key !== "method" && key !== "params")
      )
        throw fail("protocol_violation");
      return; // Deliberately discard params, including unknown fields.
    }
    const expected = state === "initialize" ? 1 : state === "operation" ? 2 : null;
    if (
      expected === null ||
      message.id !== expected ||
      own(message, "result") === own(message, "error") ||
      Object.keys(message).some((key) => !["id", "result", "error"].includes(key))
    )
      throw fail("protocol_violation");
    if (own(message, "error")) throw fail("source_unavailable");
    if (state === "initialize") {
      validateInitialize(message.result, home);
      state = "operation";
      api.send({ method: "initialized", params: {} });
      api.deadline(kind === "list" ? limits.listMs : limits.readMs);
      api.send({
        id: 2,
        method: kind === "list" ? "thread/list" : "thread/read",
        params:
          kind === "list"
            ? {
                archived: false,
                sourceKinds: [...sources],
                useStateDbOnly: true,
                sortKey: "recency_at",
                sortDirection: "desc",
                limit: 5,
                cursor,
              }
            : { threadId: taskId, includeTurns: true },
      });
      return;
    }
    const result = message.result;
    if (!object(result)) throw fail("protocol_violation");
    if (kind === "list") {
      if (
        !Array.isArray(result.data) ||
        result.data.length > 5 ||
        !(
          result.nextCursor === null ||
          (typeof result.nextCursor === "string" && result.nextCursor.length <= 4096)
        )
      )
        throw fail("protocol_violation");
    } else if (
      !object(result.thread) ||
      result.thread.id !== taskId ||
      !sources.has(result.thread.source) ||
      !Array.isArray(result.thread.turns)
    )
      throw fail("protocol_violation");
    state = "done";
    api.complete(result);
  }
  const response = await runOwnedProcess({
    command,
    args: [...argvPrefix, ...APP_ARGS],
    home,
    owner,
    signal,
    sampleGroup,
    lifetimeMs: kind === "list" ? limits.listLifetimeMs : limits.readLifetimeMs,
    onStart(api) {
      api.deadline(limits.initializeMs);
      api.send({ id: 1, method: "initialize", params: INITIALIZE });
    },
    onData(bytes, api) {
      let offset = 0;
      while (offset < bytes.length) {
        const newline = bytes.indexOf(10, offset);
        const end = newline === -1 ? bytes.length : newline;
        // Enforce the raw byte line limit before decoding or parsing.
        if (pending.length + end - offset > limits.lineBytes) throw fail("resource_limit");
        pending = Buffer.concat([pending, bytes.subarray(offset, end)]);
        if (newline === -1) break;
        const line = pending;
        pending = Buffer.alloc(0);
        accept(line, api);
        offset = newline + 1;
      }
    },
    onEnd() {
      if (pending.length) throw fail("protocol_violation");
    },
  });
  return { result: response.value, metrics: response.metrics };
}
