// @vitest-environment node
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createCodexAppServerReaderForTest,
  type CodexReaderTestDependencies,
} from "@/server/codex/app-server-reader";
import { createOwnedTemp, type OwnedTemp } from "@/server/codex/owned-temp.mjs";
import { exchangeAppServer, probeVersion } from "@/server/codex/protocol.mjs";
import type { CodexPanelDescriptor } from "@/server/panels/registry";
import { resolvePanel, resolvePanelRegistry } from "@/server/panels/registry";
import { SourceSecurityError } from "@/server/security/errors";

function panel(home: string): CodexPanelDescriptor {
  const resolved = resolvePanel(resolvePanelRegistry({ COCKPIT_CODEX_HOME: home }), "codex");
  if (resolved.runtime !== "codex") throw new Error("synthetic panel mismatch");
  return resolved;
}

const metrics = Object.freeze({
  stdoutBytes: 1,
  stderrBytes: 0,
  peakRssKiB: 1,
  samples: 1,
  closed: true,
});

describe("one-operation Codex reader", () => {
  let fixture: string;
  let tempParent: string;
  let selectedPanel: CodexPanelDescriptor;
  let order: string[];
  let operationDirectories: string[];
  let activeWriter: Database.Database | undefined;

  beforeEach(() => {
    fixture = realpathSync(mkdtempSync(path.join(realpathSync("/tmp"), "cockpit-codex-reader-")));
    chmodSync(fixture, 0o700);
    tempParent = path.join(fixture, "owned");
    selectedPanel = panel(path.join(fixture, "configured-home"));
    order = [];
    operationDirectories = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    activeWriter?.close();
    activeWriter = undefined;
    rmSync(fixture, { recursive: true, force: true });
  });

  function owned(): OwnedTemp {
    order.push("create-owned");
    const allocation = createOwnedTemp({ parent: tempParent });
    operationDirectories.push(allocation.directory);
    return {
      ...allocation,
      cleanup() {
        order.push("cleanup");
        return allocation.cleanup();
      },
    };
  }

  function dependencies(
    overrides: Partial<CodexReaderTestDependencies> = {},
  ): CodexReaderTestDependencies {
    const base: CodexReaderTestDependencies = {
      createOwnedTemp: owned,
      context: {
        async resolveExecutable(receivedPanel) {
          order.push("executable");
          expect(receivedPanel).toBe(selectedPanel);
          return "/synthetic/codex";
        },
        async resolveSource(receivedPanel, kind) {
          order.push(`source:${kind}`);
          expect(receivedPanel).toBe(selectedPanel);
          return Object.freeze({
            stateDatabase: path.join(fixture, "source", "state_5.sqlite"),
            rolloutRoots: Object.freeze([
              path.join(fixture, "source", "sessions"),
              path.join(fixture, "source", "archived_sessions"),
            ]),
          });
        },
      },
      async probeVersion(options) {
        order.push("probe");
        expect(options.command).toBe("/synthetic/codex");
        expect(lstatSync(path.join(options.home, "tmp")).mode & 0o7777).toBe(0o700);
        return { version: "0.145.0", metrics };
      },
      async createStateSnapshot(options) {
        order.push("snapshot");
        return {
          database: path.join(options.owner.directory, "state_5.sqlite"),
          placeholder: path.join(options.owner.directory, "placeholder.jsonl"),
          rollout:
            "selectedTaskId" in options
              ? path.join(options.owner.directory, "selected.jsonl")
              : null,
          copiedRowExists: "selectedTaskId" in options,
        };
      },
      async exchangeAppServer(options) {
        order.push("exchange");
        return {
          result:
            options.kind === "list"
              ? { data: [], nextCursor: null }
              : { thread: { id: options.taskId, source: "cli", turns: [] } },
          metrics,
        };
      },
      async verifyCopiedTask(options) {
        order.push("recheck");
        expect(options.database).toBe(path.join(options.owner.directory, "state_5.sqlite"));
        expect(options.rollout).toBe(path.join(options.owner.directory, "selected.jsonl"));
      },
    };
    return { ...base, ...overrides };
  }

  it("runs probe, snapshot and one exchange inside one owned home, then cleans before releasing", async () => {
    const reader = createCodexAppServerReaderForTest(dependencies());

    await expect(reader.list(selectedPanel, { cursor: "synthetic-cursor" })).resolves.toEqual({
      data: [],
      nextCursor: null,
    });
    await expect(
      reader.read(selectedPanel, "11111111-1111-4111-8111-000000000001"),
    ).resolves.toMatchObject({
      thread: { source: "cli" },
    });

    expect(order).toEqual([
      "create-owned",
      "executable",
      "probe",
      "source:list",
      "snapshot",
      "exchange",
      "cleanup",
      "create-owned",
      "executable",
      "probe",
      "source:read",
      "snapshot",
      "exchange",
      "recheck",
      "cleanup",
    ]);
    expect(operationDirectories.every((directory) => !existsSync(directory))).toBe(true);
  });

  it("reports one list operation as separate runtime and task stages", async () => {
    const reader = createCodexAppServerReaderForTest(
      dependencies({
        async createStateSnapshot() {
          order.push("snapshot");
          throw new SourceSecurityError("source_busy");
        },
      }),
    );

    await expect(reader.observeList(selectedPanel)).resolves.toEqual({
      runtime: { state: "ready", version: "0.145.0" },
      tasks: { state: "failed", code: "source_busy" },
    });
    expect(order).toEqual([
      "create-owned",
      "executable",
      "probe",
      "source:list",
      "snapshot",
      "cleanup",
    ]);
    expect(operationDirectories.every((directory) => !existsSync(directory))).toBe(true);
  });

  it("fails both list stages when the isolated runtime probe fails", async () => {
    const resolveSource = vi.fn(async () => ({ stateDatabase: "/unused", rolloutRoots: [] }));
    const reader = createCodexAppServerReaderForTest(
      dependencies({
        context: {
          resolveExecutable: async () => "/synthetic/codex",
          resolveSource,
        },
        async probeVersion() {
          throw new SourceSecurityError("unsupported_runtime_version");
        },
      }),
    );

    await expect(reader.observeList(selectedPanel)).resolves.toEqual({
      runtime: { state: "failed", code: "unsupported_runtime_version" },
      tasks: { state: "failed", code: "unsupported_runtime_version" },
    });
    expect(resolveSource).not.toHaveBeenCalled();
  });

  it("probes System runtime without resolving or copying the Codex state source", async () => {
    const deps = dependencies();
    const resolveSource = vi.spyOn(deps.context, "resolveSource");
    const snapshot = vi.spyOn(deps, "createStateSnapshot");
    const exchange = vi.spyOn(deps, "exchangeAppServer");
    const reader = createCodexAppServerReaderForTest(deps);

    await expect(reader.probe(selectedPanel)).resolves.toEqual({ version: "0.145.0" });
    expect(resolveSource).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
    expect(exchange).not.toHaveBeenCalled();
    expect(order).toEqual(["create-owned", "executable", "probe", "cleanup"]);
  });

  it("has one slot with no queue and releases it only after first-operation cleanup", async () => {
    let releaseFirst: () => void = () => {};
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    const reader = createCodexAppServerReaderForTest(
      dependencies({
        async probeVersion() {
          order.push("probe");
          calls += 1;
          if (calls === 1) {
            markStarted();
            await gate;
          }
          return { version: "0.145.0", metrics };
        },
      }),
    );

    const first = reader.list(selectedPanel);
    await started;
    await expect(reader.list(selectedPanel)).rejects.toMatchObject({ code: "source_busy" });
    expect(operationDirectories).toHaveLength(1);
    releaseFirst();
    await expect(first).resolves.toMatchObject({ nextCursor: null });
    await expect(reader.list(selectedPanel)).resolves.toMatchObject({ nextCursor: null });
    expect(operationDirectories).toHaveLength(2);
  });

  it("keeps the slot and owned copy until the asynchronous post-response verifier finishes", async () => {
    let releaseVerify: () => void = () => {};
    let markVerifying: () => void = () => {};
    const verifying = new Promise<void>((resolve) => {
      markVerifying = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseVerify = resolve;
    });
    const reader = createCodexAppServerReaderForTest(
      dependencies({
        async verifyCopiedTask() {
          order.push("recheck");
          markVerifying();
          await gate;
        },
      }),
    );

    const first = reader.read(selectedPanel, "11111111-1111-4111-8111-000000000001");
    await verifying;
    expect(operationDirectories).toHaveLength(1);
    const operationDirectory = operationDirectories[0];
    if (operationDirectory === undefined) throw new Error("synthetic operation directory missing");
    expect(existsSync(operationDirectory)).toBe(true);
    await expect(reader.list(selectedPanel)).rejects.toMatchObject({ code: "source_busy" });
    releaseVerify();
    await expect(first).resolves.toMatchObject({ thread: { source: "cli" } });
    expect(existsSync(operationDirectory)).toBe(false);
  });

  it("cancels only the current operation and lets a later request use a fresh slot", async () => {
    const abort = new AbortController();
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let calls = 0;
    const reader = createCodexAppServerReaderForTest(
      dependencies({
        probeVersion(options) {
          calls += 1;
          if (calls > 1) return Promise.resolve({ version: "0.145.0", metrics });
          markStarted();
          return new Promise((_, reject) =>
            options.signal?.addEventListener(
              "abort",
              () => {
                reject(Object.freeze({ code: "aborted" }));
              },
              { once: true },
            ),
          );
        },
      }),
    );

    const first = reader.list(selectedPanel, { signal: abort.signal });
    await started;
    abort.abort();
    await expect(first).rejects.toMatchObject({ code: "source_unavailable" });
    await expect(reader.list(selectedPanel)).resolves.toMatchObject({ nextCursor: null });
    expect(operationDirectories).toHaveLength(2);
    expect(operationDirectories.every((directory) => !existsSync(directory))).toBe(true);
  });

  it("does not resolve an executable or touch a source for a pre-aborted operation", async () => {
    const context = {
      resolveExecutable: vi.fn(async () => "/synthetic/codex"),
      resolveSource: vi.fn(async () => ({
        stateDatabase: "/synthetic/source/state_5.sqlite",
        rolloutRoots: [],
      })),
    };
    const reader = createCodexAppServerReaderForTest(dependencies({ context }));
    const abort = new AbortController();
    abort.abort();

    await expect(reader.list(selectedPanel, { signal: abort.signal })).rejects.toMatchObject({
      code: "source_unavailable",
    });
    expect(context.resolveExecutable).not.toHaveBeenCalled();
    expect(context.resolveSource).not.toHaveBeenCalled();
    expect(order).toEqual([]);
    expect(operationDirectories).toHaveLength(0);
  });

  it("normalizes private dependency failures and still removes the owned operation", async () => {
    const reader = createCodexAppServerReaderForTest(
      dependencies({
        async createStateSnapshot() {
          throw Object.assign(new Error("/synthetic/private/path"), { code: "protocol_violation" });
        },
      }),
    );

    const error = await reader.list(selectedPanel).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SourceSecurityError);
    expect(error).toMatchObject({
      code: "protocol_violation",
      message: "The local Agent reader returned an invalid response.",
    });
    expect(JSON.stringify(error)).not.toContain("/synthetic/private/path");
    expect(operationDirectories.every((directory) => !existsSync(directory))).toBe(true);
  });

  it("maps only a detail exchange resource limit to source_too_large", async () => {
    const resourceLimit = () => {
      throw Object.assign(new Error("synthetic resource limit"), { code: "resource_limit" });
    };
    const readExchange = createCodexAppServerReaderForTest(
      dependencies({
        exchangeAppServer: resourceLimit,
      }),
    );
    await expect(
      readExchange.read(selectedPanel, "11111111-1111-4111-8111-000000000001"),
    ).rejects.toMatchObject({ code: "source_too_large" });

    const listExchange = createCodexAppServerReaderForTest(
      dependencies({
        exchangeAppServer: resourceLimit,
      }),
    );
    await expect(listExchange.list(selectedPanel)).rejects.toMatchObject({
      code: "source_unavailable",
    });

    const probe = createCodexAppServerReaderForTest(
      dependencies({
        probeVersion: resourceLimit,
      }),
    );
    await expect(
      probe.read(selectedPanel, "11111111-1111-4111-8111-000000000001"),
    ).rejects.toMatchObject({ code: "source_unavailable" });

    const verifier = createCodexAppServerReaderForTest(
      dependencies({
        verifyCopiedTask: resourceLimit,
      }),
    );
    await expect(
      verifier.read(selectedPanel, "11111111-1111-4111-8111-000000000001"),
    ).rejects.toMatchObject({ code: "source_unavailable" });
    expect(operationDirectories.every((directory) => !existsSync(directory))).toBe(true);
  });

  it("permanently fails closed when cleanup cannot be verified", async () => {
    let allocation: OwnedTemp | undefined;
    const deps = dependencies({
      createOwnedTemp() {
        order.push("create-owned");
        allocation = createOwnedTemp({ parent: tempParent });
        operationDirectories.push(allocation.directory);
        return { ...allocation, cleanup: () => false };
      },
    });
    const reader = createCodexAppServerReaderForTest(deps);

    await expect(reader.list(selectedPanel)).rejects.toMatchObject({ code: "source_unavailable" });
    const orderAfterPoison = [...order];
    await expect(
      reader.read(selectedPanel, "11111111-1111-4111-8111-000000000001"),
    ).rejects.toMatchObject({ code: "source_unavailable" });
    expect(order).toEqual(orderAfterPoison);
    expect(operationDirectories).toHaveLength(1);

    expect(allocation?.cleanup()).toBe(true);
    for (const directory of operationDirectories) {
      if (existsSync(directory)) rmSync(directory, { recursive: true, force: true });
    }
  });

  it("permanently fails closed when cleanup throws", async () => {
    const allocations: OwnedTemp[] = [];
    const reader = createCodexAppServerReaderForTest(
      dependencies({
        createOwnedTemp() {
          order.push("create-owned");
          const allocation = createOwnedTemp({ parent: tempParent });
          allocations.push(allocation);
          operationDirectories.push(allocation.directory);
          return {
            ...allocation,
            cleanup() {
              throw new Error("synthetic cleanup failure");
            },
          };
        },
      }),
    );

    await expect(reader.list(selectedPanel)).rejects.toMatchObject({ code: "source_unavailable" });
    const orderAfterPoison = [...order];
    await expect(reader.list(selectedPanel)).rejects.toMatchObject({ code: "source_unavailable" });
    expect(order).toEqual(orderAfterPoison);
    expect(operationDirectories).toHaveLength(1);

    for (const allocation of allocations) expect(allocation.cleanup()).toBe(true);
  });

  it("runs a UUID detail through the real snapshot/protocol stack and rechecks the copied row", async () => {
    const source = path.join(fixture, "source");
    const sessions = path.join(source, "sessions");
    const archived = path.join(source, "archived_sessions");
    mkdirSync(sessions, { recursive: true, mode: 0o700 });
    mkdirSync(archived, { mode: 0o700 });
    const taskId = "11111111-1111-4111-8111-000000000001";
    const rollout = path.join(sessions, "selected.jsonl");
    writeFileSync(rollout, "{}\n", { mode: 0o600 });
    const stateDatabase = path.join(source, "state_5.sqlite");
    activeWriter = new Database(stateDatabase);
    activeWriter.pragma("journal_mode = WAL");
    activeWriter.pragma("wal_autocheckpoint = 0");
    activeWriter.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT)");
    activeWriter.prepare("INSERT INTO threads VALUES (?, ?)").run(taskId, rollout);
    expect(lstatSync(`${stateDatabase}-wal`).size).toBeGreaterThan(0);
    const fake = fileURLToPath(new URL("../helpers/codex-fake.mjs", import.meta.url));
    const sampleGroup = async () => ({ rssKiB: 1, members: 1 });
    const context = {
      async resolveExecutable() {
        return process.execPath;
      },
      async resolveSource() {
        return { stateDatabase, rolloutRoots: [sessions, archived] };
      },
    };
    const reader = createCodexAppServerReaderForTest({
      context,
      createOwnedTemp: owned,
      probeVersion: (options) => probeVersion({ ...options, argvPrefix: [fake], sampleGroup }),
      exchangeAppServer: (options) =>
        exchangeAppServer({ ...options, argvPrefix: [fake], sampleGroup }),
    });

    await expect(reader.read(selectedPanel, taskId)).resolves.toMatchObject({
      thread: { id: taskId, source: "cli" },
    });
    expect(operationDirectories.every((directory) => !existsSync(directory))).toBe(true);

    const tampered = createCodexAppServerReaderForTest({
      context,
      createOwnedTemp: owned,
      probeVersion: (options) => probeVersion({ ...options, argvPrefix: [fake], sampleGroup }),
      async exchangeAppServer(options) {
        const response = await exchangeAppServer({ ...options, argvPrefix: [fake], sampleGroup });
        const copy = new Database(path.join(options.home, "state_5.sqlite"));
        copy.prepare("DELETE FROM threads WHERE id = ?").run(taskId);
        copy.close();
        return response;
      },
    });
    await expect(tampered.read(selectedPanel, taskId)).rejects.toMatchObject({
      code: "protocol_violation",
    });
    expect(operationDirectories.every((directory) => !existsSync(directory))).toBe(true);
  }, 15_000);
});
