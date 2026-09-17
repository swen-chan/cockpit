import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import Database from "better-sqlite3";

import {
  assertHermesFixtureSourcesUnchanged,
  createHermesFixture,
  removeHermesFixture,
  snapshotHermesFixtureSources,
} from "../helpers/hermes-fixture.ts";

const SOURCE_ENVIRONMENT_KEYS = Object.freeze([
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
]);
const EMPTY_SOURCE_ENVIRONMENT = Object.freeze(
  Object.fromEntries(SOURCE_ENVIRONMENT_KEYS.map((key) => [key, ""])),
);
const TASK_IDS = Object.freeze(
  Array.from(
    { length: 7 },
    (_, index) => `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
  ),
);
const fakeCodexModule = fileURLToPath(new URL("../helpers/codex-fake.mjs", import.meta.url));

const forwardedArguments = process.argv.slice(2);
if (forwardedArguments[0] === "--") forwardedArguments.shift();

let activeChild;
let interruptedSignal;

function forwardSignal(signal) {
  interruptedSignal = signal;
  if (activeChild && !activeChild.killed) activeChild.kill(signal);
}

process.once("SIGINT", () => forwardSignal("SIGINT"));
process.once("SIGTERM", () => forwardSignal("SIGTERM"));

function loopbackNoProxy(existing) {
  const entries = (existing ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return [...new Set([...entries, "localhost", "127.0.0.1", "::1"])].join(",");
}

function fingerprint(filename) {
  const stats = statSync(filename, { bigint: true });
  return Object.freeze({
    hash: createHash("sha256").update(readFileSync(filename)).digest("hex"),
    mtime: stats.mtimeNs.toString(),
    size: stats.size.toString(),
  });
}

function snapshotTrees(roots) {
  const snapshot = new Map();
  function visit(filename) {
    const stats = lstatSync(filename);
    if (stats.isDirectory()) {
      snapshot.set(filename, Object.freeze({ kind: "directory" }));
      for (const name of readdirSync(filename).sort()) visit(path.join(filename, name));
      return;
    }
    if (stats.isFile()) {
      snapshot.set(filename, Object.freeze({ kind: "file", ...fingerprint(filename) }));
      return;
    }
    snapshot.set(filename, Object.freeze({ kind: "unsupported" }));
  }
  for (const root of roots) visit(root);
  return snapshot;
}

function sourceLabel(fixture, filename) {
  if (filename === fixture.home || filename.startsWith(`${fixture.home}${path.sep}`)) {
    return `codex-home/${path.relative(fixture.home, filename) || "."}`;
  }
  return `workspace/${path.relative(fixture.workspaceRoot, filename) || "."}`;
}

function threadFixture({
  cwd,
  home,
  id,
  name,
  preview,
  recencyAt,
  source,
  status = { type: "idle" },
  turns = [],
}) {
  return {
    id,
    sessionId: `session-${id}`,
    preview,
    ephemeral: false,
    modelProvider: "synthetic",
    createdAt: recencyAt - 100,
    updatedAt: recencyAt - 1,
    recencyAt,
    status,
    path: path.join(home, "sessions", `${id}.jsonl`),
    cwd,
    cliVersion: "0.145.0",
    source,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name,
    turns,
  };
}

function browserCodexProtocolFixture(mode, home, workspaceRoot) {
  const projectRoot = path.join(workspaceRoot, "cockpit-project");
  const longProject = `project-${"x".repeat(72)}`;
  const configurations = [
    {
      name: "Inspect Cockpit safety",
      preview: "Review the bounded read-only surface",
      source: "cli",
      cwd: projectRoot,
    },
    {
      name: "Unknown project task",
      preview: "Project context is intentionally unavailable",
      source: "cli",
      cwd: "/",
    },
    {
      name: "Long project task",
      preview: "A bounded long Project label",
      source: "vscode",
      cwd: path.join(workspaceRoot, longProject),
    },
    {
      name: "VS Code integration",
      preview: "Inspect editor-originated history",
      source: "vscode",
      cwd: path.join(workspaceRoot, "editor-project"),
    },
    {
      name: "App Server integration",
      preview: "Inspect app-server task history",
      source: "appServer",
      cwd: path.join(workspaceRoot, "server-project"),
    },
    {
      name: "Older CLI task",
      preview: "Second-page task one",
      source: "cli",
      cwd: path.join(workspaceRoot, "older-one"),
    },
    {
      name: "Older App task",
      preview: "Second-page task two",
      source: "appServer",
      cwd: path.join(workspaceRoot, "older-two"),
    },
  ];
  const summaries = configurations.map((configuration, index) =>
    threadFixture({
      ...configuration,
      home,
      id: TASK_IDS[index],
      recencyAt: 1_700_100_000 - index,
      status: index === 3 ? { type: "active", activeFlags: [] } : { type: "idle" },
    }),
  );
  const richTurns = [
    {
      id: "synthetic-rich-turn",
      status: "completed",
      error: null,
      itemsView: "full",
      items: [
        {
          type: "userMessage",
          id: "synthetic-user",
          content: [{ type: "text", text: "Inspect the safe workspace", text_elements: [] }],
        },
        {
          type: "agentMessage",
          id: "synthetic-progress",
          text: "SAFE_PROGRESS_MARKER",
          phase: "commentary",
        },
        {
          type: "reasoning",
          id: "synthetic-reasoning",
          summary: ["SAFE_REASONING_SUMMARY_MARKER"],
          content: ["FORBIDDEN_RAW_REASONING_MARKER"],
        },
        { type: "plan", id: "synthetic-plan", text: "SAFE_PLAN_MARKER" },
        {
          type: "commandExecution",
          id: "synthetic-command",
          command: "FORBIDDEN_RAW_COMMAND_MARKER --token=synthetic-secret",
          commandActions: [
            {
              type: "listFiles",
              command: "FORBIDDEN_RAW_ACTION_MARKER",
              path: "src",
            },
          ],
          cwd: projectRoot,
          status: "completed",
          aggregatedOutput: "a.ts\nSAFE_OUTPUT_MARKER.txt",
          durationMs: 21,
          exitCode: 0,
        },
        {
          type: "fileChange",
          id: "synthetic-changes",
          status: "completed",
          changes: [
            {
              path: "src/a.ts",
              kind: { type: "update", move_path: null },
              diff: [
                "diff --git a/FORBIDDEN_OLD_PATH b/FORBIDDEN_NEW_PATH",
                "--- /Users/private/FORBIDDEN_PATCH_HEADER",
                "+++ /Users/private/FORBIDDEN_PATCH_HEADER",
                "@@ -1 +1 @@",
                "-export const before = true;",
                "+export const SAFE_PATCH_MARKER = true;",
              ].join("\n"),
            },
          ],
        },
        {
          type: "imageView",
          id: "synthetic-image",
          path: path.join(projectRoot, "assets", "diagram.png"),
        },
        {
          type: "webSearch",
          id: "synthetic-web-search",
          query: "FORBIDDEN_WEB_QUERY_MARKER",
          action: { type: "search", query: "FORBIDDEN_WEB_ACTION_MARKER", queries: null },
          results: [{ title: "FORBIDDEN_WEB_RESULT_MARKER" }],
        },
        {
          type: "dynamicToolCall",
          id: "synthetic-hidden-one",
          tool: "FORBIDDEN_TOOL_NAME_MARKER",
          arguments: { secret: "FORBIDDEN_TOOL_ARGUMENT_MARKER" },
          status: "completed",
          durationMs: 5,
          contentItems: null,
          success: true,
        },
        {
          type: "dynamicToolCall",
          id: "synthetic-hidden-two",
          tool: "FORBIDDEN_TOOL_NAME_MARKER_TWO",
          arguments: { secret: "FORBIDDEN_TOOL_ARGUMENT_MARKER_TWO" },
          status: "completed",
          durationMs: 5,
          contentItems: null,
          success: true,
        },
        {
          type: "agentMessage",
          id: "synthetic-final",
          text: "SAFE_FINAL_ANSWER_MARKER",
          phase: "final_answer",
        },
      ],
    },
    {
      id: "synthetic-no-final-turn",
      status: "completed",
      error: null,
      itemsView: "full",
      items: [
        {
          type: "userMessage",
          id: "synthetic-no-final-user",
          content: [
            {
              type: "text",
              text: "Show a terminal turn without a final answer",
              text_elements: [],
            },
          ],
        },
        {
          type: "agentMessage",
          id: "synthetic-no-final-progress",
          text: "SAFE_NO_FINAL_PROGRESS_MARKER",
          phase: "commentary",
        },
      ],
    },
  ];
  const readResultsById = Object.fromEntries(
    summaries.map((summary, index) => [
      summary.id,
      {
        thread: {
          ...summary,
          turns:
            index === 0
              ? richTurns
              : [
                  {
                    id: `synthetic-turn-${index}`,
                    status: "completed",
                    error: null,
                    itemsView: "full",
                    items: [
                      {
                        type: "userMessage",
                        id: `synthetic-user-${index}`,
                        content: [
                          { type: "text", text: `Synthetic question ${index}`, text_elements: [] },
                        ],
                      },
                      {
                        type: "agentMessage",
                        id: `synthetic-answer-${index}`,
                        text: `Synthetic answer ${index}`,
                        phase: "final_answer",
                      },
                    ],
                  },
                ],
        },
      },
    ]),
  );
  return {
    mode,
    listResultsByCursor: {
      __initial__: { data: summaries.slice(0, 5), nextCursor: "older-page" },
      "older-page": { data: summaries.slice(5), nextCursor: null },
    },
    readResultsById,
  };
}

function createCodexFixture(mode) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "cockpit-browser-codex-")));
  const home = path.join(root, "home");
  const bin = path.join(root, "bin");
  const auditLog = path.join(root, "codex-audit.log");
  const executable = path.join(bin, "codex");
  const databasePath = path.join(home, "state_5.sqlite");
  const sessions = path.join(home, "sessions");
  const workspaceRoot = path.join(root, "workspace");
  const projectRoot = path.join(workspaceRoot, "cockpit-project");

  try {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    mkdirSync(bin, { recursive: true, mode: 0o700 });
    mkdirSync(sessions, { recursive: true, mode: 0o700 });
    mkdirSync(path.join(workspaceRoot, "empty-directory"), { recursive: true, mode: 0o700 });
    mkdirSync(path.join(projectRoot, "src"), { recursive: true, mode: 0o700 });
    mkdirSync(path.join(projectRoot, "assets"), { recursive: true, mode: 0o700 });
    for (const name of [
      `project-${"x".repeat(72)}`,
      "editor-project",
      "server-project",
      "older-one",
      "older-two",
    ])
      mkdirSync(path.join(workspaceRoot, name), { recursive: true, mode: 0o700 });
    chmodSync(home, 0o700);
    chmodSync(bin, 0o700);
    writeFileSync(auditLog, "", { mode: 0o600 });
    writeFileSync(path.join(home, "AGENTS.md"), "# FORBIDDEN_LOWER_PRECEDENCE_GLOBAL_MARKER\n", {
      mode: 0o600,
    });
    writeFileSync(
      path.join(home, "AGENTS.override.md"),
      [
        "# Global guidance",
        "",
        "SAFE_GLOBAL_GUIDANCE_MARKER",
        "",
        "[Inert guidance link](https://example.invalid/guidance)",
        "",
        "![Remote guidance image](https://example.invalid/guidance.png)",
        "",
        "<script>window.FORBIDDEN_GUIDANCE_SCRIPT_EXECUTION = true</script>",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    writeFileSync(
      path.join(workspaceRoot, "AGENTS.md"),
      "# Workspace guidance\n\nSAFE_WORKSPACE_GUIDANCE_MARKER\n",
      { mode: 0o600 },
    );
    writeFileSync(
      path.join(workspaceRoot, "SOUL.md"),
      "# Custom guidance\n\nSAFE_CUSTOM_GUIDANCE_MARKER\n",
      { mode: 0o600 },
    );
    writeFileSync(
      path.join(workspaceRoot, "README.md"),
      [
        "# Synthetic workspace",
        "",
        "SAFE_FILE_PREVIEW_MARKER",
        "",
        "[Inert link](https://example.invalid/private)",
        "",
        "![Remote image](https://example.invalid/private.png)",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    writeFileSync(path.join(workspaceRoot, "metadata.bin"), Buffer.from([0x00, 0x01, 0x02]), {
      mode: 0o600,
    });
    writeFileSync(path.join(projectRoot, "src", "a.ts"), "export const before = true;\n", {
      mode: 0o600,
    });
    writeFileSync(path.join(projectRoot, "src", "SAFE_OUTPUT_MARKER.txt"), "safe output marker\n", {
      mode: 0o600,
    });
    writeFileSync(path.join(projectRoot, "assets", "diagram.png"), "synthetic image\n", {
      mode: 0o600,
    });

    const database = new Database(databasePath);
    try {
      database.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT)");
      const insert = database.prepare("INSERT INTO threads VALUES (?, ?)");
      for (const id of TASK_IDS) {
        const rollout = path.join(sessions, `${id}.jsonl`);
        writeFileSync(rollout, `${JSON.stringify({ synthetic: id })}\n`, { mode: 0o600 });
        insert.run(id, rollout);
      }
    } finally {
      database.close();
    }
    chmodSync(databasePath, 0o600);
    const protocolFixture = browserCodexProtocolFixture(mode, home, workspaceRoot);
    if (Buffer.byteLength(JSON.stringify(protocolFixture)) > 64 * 1024) {
      throw new Error("Synthetic Codex protocol fixture exceeds the fake reader limit.");
    }

    const wrapper = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");

const kind = process.argv[2] === "--version"
  ? "version"
  : process.argv[2] === "app-server"
    ? "app-server"
    : null;
if (!kind) process.exit(2);
fs.appendFileSync(${JSON.stringify(auditLog)}, kind + "\\n", { encoding: "utf8", mode: 0o600 });
if (kind === "version") {
  fs.writeSync(1, ${JSON.stringify(mode === "wrong-version" ? "codex-cli 0.153.4\n" : "codex-cli 0.145.0\n")});
  process.exit(0);
}
fs.writeFileSync(
  path.join(process.env.HOME, "fixture-mode.json"),
  ${JSON.stringify(JSON.stringify(protocolFixture))},
  { encoding: "utf8", mode: 0o600 },
);
(async () => {
  await import(${JSON.stringify(pathToFileURL(fakeCodexModule).href)});
})().catch(() => process.exit(2));
`;
    writeFileSync(executable, wrapper, { mode: 0o700 });
    chmodSync(executable, 0o700);

    return Object.freeze({
      auditLog,
      databasePath,
      environment: Object.freeze({
        COCKPIT_CODEX_HOME: home,
        COCKPIT_CODEX_WORKSPACE_ROOT: workspaceRoot,
        COCKPIT_CODEX_CUSTOM_GUIDANCE: "SOUL.md",
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? "/usr/bin:/bin"}`,
      }),
      home,
      root,
      sourceSnapshot: snapshotTrees([home, workspaceRoot]),
      workspaceRoot,
    });
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function assertCodexFixtureSourcesUnchanged(fixture) {
  const changes = [];
  const current = snapshotTrees([fixture.home, fixture.workspaceRoot]);
  for (const [filename, observed] of current) {
    const expected = fixture.sourceSnapshot.get(filename);
    if (expected) {
      if (expected.kind !== observed.kind)
        changes.push(`${sourceLabel(fixture, filename)}: type changed`);
      if (expected.kind === "file" && observed.kind === "file") {
        for (const key of ["hash", "mtime", "size"]) {
          if (expected[key] !== observed[key])
            changes.push(`${sourceLabel(fixture, filename)}: ${key} changed`);
        }
      }
      continue;
    }
    if (filename === `${fixture.databasePath}-wal`) {
      const stats = lstatSync(filename);
      if (stats.isFile() && stats.size === 0) continue;
    }
    if (filename === `${fixture.databasePath}-shm` && lstatSync(filename).isFile()) continue;
    changes.push(`${sourceLabel(fixture, filename)}: created`);
  }
  for (const filename of fixture.sourceSnapshot.keys()) {
    if (!current.has(filename)) changes.push(`${sourceLabel(fixture, filename)}: removed`);
  }
  if (changes.length > 0) {
    throw new Error(
      `Synthetic Codex sources changed during read-only verification:\n${changes.join("\n")}`,
    );
  }
}

async function reservePort() {
  const server = createServer();
  const port = await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to reserve a loopback browser-test port."));
        return;
      }
      resolve(address.port);
    });
  });
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function runPlaywright(environment) {
  activeChild = spawn(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["exec", "playwright", "test", "--pass-with-no-tests", ...forwardedArguments],
    {
      env: environment,
      stdio: "inherit",
    },
  );

  try {
    return await new Promise((resolve, reject) => {
      activeChild.once("error", reject);
      activeChild.once("close", (code, signal) => {
        if (typeof code === "number") resolve(code);
        else resolve(signal || interruptedSignal ? 1 : 0);
      });
    });
  } finally {
    activeChild = undefined;
  }
}

async function runScenario({ name, codexMode }) {
  let codex;
  let hermes;
  let hermesSnapshot;
  let exitCode = 1;
  try {
    hermes = createHermesFixture(`cockpit-browser-${name}-hermes-`);
    hermesSnapshot = snapshotHermesFixtureSources(hermes);
    if (codexMode) codex = createCodexFixture(codexMode);

    const port = await reservePort();
    const baseURL = `http://127.0.0.1:${port}`;
    const command = process.env.CI
      ? `pnpm exec next start --hostname 127.0.0.1 --port ${port}`
      : `pnpm exec next dev --hostname 127.0.0.1 --port ${port}`;
    console.log(`\n[synthetic browser scenario] ${name} at ${baseURL}`);
    exitCode = await runPlaywright({
      ...process.env,
      ...EMPTY_SOURCE_ENVIRONMENT,
      ...hermes.environment,
      ...(codex?.environment ?? {}),
      COCKPIT_E2E_BASE_URL: baseURL,
      COCKPIT_E2E_CODEX_AUDIT_LOG: codex?.auditLog ?? "",
      COCKPIT_E2E_SCENARIO: name,
      COCKPIT_E2E_SYNTHETIC: "1",
      COCKPIT_E2E_WEB_COMMAND: command,
      NEXT_TELEMETRY_DISABLED: "1",
      NO_PROXY: loopbackNoProxy(process.env.NO_PROXY),
      no_proxy: loopbackNoProxy(process.env.no_proxy),
    });
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    try {
      if (hermesSnapshot) assertHermesFixtureSourcesUnchanged(hermesSnapshot);
      if (codex) assertCodexFixtureSourcesUnchanged(codex);
    } catch (error) {
      console.error(error);
      exitCode = 1;
    } finally {
      if (hermes) removeHermesFixture(hermes);
      if (codex) rmSync(codex.root, { recursive: true, force: true });
    }
  }
  return exitCode;
}

const scenarios = Object.freeze([
  Object.freeze({ name: "legacy-ready", codexMode: null }),
  Object.freeze({ name: "dual-ready", codexMode: "success" }),
  Object.freeze({ name: "dual-codex-unavailable", codexMode: "wrong-version" }),
]);

let exitCode = 0;
for (const scenario of scenarios) {
  if (interruptedSignal) {
    exitCode = 1;
    break;
  }
  if ((await runScenario(scenario)) !== 0) exitCode = 1;
}

process.exitCode = exitCode;
