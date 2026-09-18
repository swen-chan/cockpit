// @vitest-environment node
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exchangeAppServer, probeVersion } from "@/server/codex/protocol.mjs";

const fakePath = fileURLToPath(new URL("../helpers/codex-fake.mjs", import.meta.url));
const safeCodes = [
  "protocol_violation",
  "resource_limit",
  "timeout",
  "aborted",
  "source_unavailable",
];

interface Observation {
  method: string;
  id: number | null;
  params: Record<string, unknown> | null;
}

interface ProcessObservation {
  argv: string[];
  env: Record<string, string>;
}

describe("Codex bounded synthetic stdio contract", () => {
  let home: string;
  let groups: number[];

  beforeEach(() => {
    home = realpathSync(mkdtempSync(path.join(tmpdir(), "cockpit-fake-contract-")));
    chmodSync(home, 0o700);
    mkdirSync(path.join(home, "tmp"), { mode: 0o700 });
    groups = [];
  });

  afterEach(() => {
    // The fixtures are ours; cleanup remains unconditional if an assertion fails.
    for (const pgid of groups) {
      try {
        process.kill(-pgid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
    rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  function configure(mode = "success", fixture: Record<string, unknown> = {}) {
    writeFileSync(
      path.join(home, "fixture-mode.json"),
      JSON.stringify({ mode, recordRequests: true, ...fixture }),
      { mode: 0o600 },
    );
  }

  function options(argvPrefix = [fakePath]) {
    return {
      command: process.execPath,
      argvPrefix,
      home,
      owner: {
        directory: home,
        markerPath: path.join(home, "fixture-owner.json"),
        recordProcess: (record: { pgid: number }) => {
          groups.push(record.pgid);
        },
        cleanup: () => true,
      },
      // This proves handling of sampled values, not actual OS RSS measurement.
      sampleGroup: async () => ({ rssKiB: 1, members: 1 }),
    };
  }

  function observations(): Observation[] {
    const filename = path.join(home, "fixture-observations.jsonl");
    if (!existsSync(filename)) return [];
    return readFileSync(filename, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Observation);
  }

  function writeModule(name: string, source: string) {
    const filename = path.join(home, name);
    writeFileSync(filename, source, { mode: 0o600 });
    return filename;
  }

  function observingFixture() {
    return writeModule(
      "observe-codex-fixture.mjs",
      `
      import fs from "node:fs";
      import path from "node:path";
      fs.appendFileSync(
        path.join(process.env.HOME, "fixture-process-observations.jsonl"),
        JSON.stringify({ argv: process.argv.slice(2), env: process.env }) + "\\n",
        { mode: 0o600 },
      );
      await import(${JSON.stringify(pathToFileURL(fakePath).href)});
    `,
    );
  }

  function processObservations(): ProcessObservation[] {
    const filename = path.join(home, "fixture-process-observations.jsonl");
    if (!existsSync(filename)) return [];
    return readFileSync(filename, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ProcessObservation);
  }

  function assertGroupsGone() {
    expect(groups.length).toBeGreaterThan(0);
    for (const pgid of groups) {
      expect(() => process.kill(-pgid, 0)).toThrowError(expect.objectContaining({ code: "ESRCH" }));
    }
  }

  async function waitForOperation() {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if (observations().some((row) => row.method === "thread/list")) return;
      await delay(10);
    }
    throw new Error("synthetic fixture did not receive its operation");
  }

  it("accepts the exact standalone version and reclaims its group", async () => {
    configure();
    await expect(probeVersion(options())).resolves.toMatchObject({ version: "0.145.0" });
    assertGroupsGone();
  });

  it("classifies a well-formed different CLI version without exposing it", async () => {
    configure("wrong-version");
    const error = await probeVersion(options()).catch((error: unknown) => error);
    expect(error).toMatchObject({
      code: "unsupported_runtime_version",
      message: "unsupported_runtime_version",
    });
    expect(JSON.stringify(error)).not.toContain("0.153.4");
    assertGroupsGone();
  });

  it("keeps malformed version output classified as a protocol violation", async () => {
    const peer = writeModule(
      "malformed-version.mjs",
      `process.stdout.write("codex-cli banana\\n");`,
    );
    await expect(probeVersion(options([peer]))).rejects.toMatchObject({
      code: "protocol_violation",
    });
    assertGroupsGone();
  });

  it.each(["version-overflow", "version-early-exit"])(
    "rejects the standalone %s fixture with only a safe diagnostic",
    async (mode) => {
      configure(mode);
      const error = await probeVersion(options()).catch((error: unknown) => error);
      expect(error).toMatchObject({
        code: expect.stringMatching(/^(resource_limit|source_unavailable|protocol_violation)$/),
      });
      assertGroupsGone();
    },
  );

  it("caps the version probe's combined stdout and stderr, not just one stream", async () => {
    configure("version-combined-overflow");
    await expect(probeVersion(options())).rejects.toMatchObject({ code: "resource_limit" });
    assertGroupsGone();
  });

  it("uses exact fixed argv and the same credential-free Codex environment for probe and App Server", async () => {
    configure();
    const secrets = [
      "SYNTHETIC_OPENAI_SECRET",
      "SYNTHETIC_PROXY_SECRET",
      "SYNTHETIC_NODE_SECRET",
      "SYNTHETIC_DYLD_SECRET",
      "SYNTHETIC_COCKPIT_SECRET",
    ];
    vi.stubEnv("OPENAI_API_KEY", secrets[0]);
    vi.stubEnv("HTTPS_PROXY", secrets[1]);
    vi.stubEnv("NODE_OPTIONS", "--trace-warnings");
    vi.stubEnv("DYLD_INSERT_LIBRARIES", secrets[3]);
    vi.stubEnv("COCKPIT_PRIVATE_MARKER", secrets[4]);
    const fixture = observingFixture();
    await probeVersion(options([fixture]));
    await exchangeAppServer({ ...options([fixture]), kind: "list" });
    const rows = processObservations();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.argv)).toEqual([
      ["--version"],
      [
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
      ],
    ]);
    const expectedEnvironment = {
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      LANG: "C",
      LC_ALL: "C",
      HOME: home,
      TMPDIR: path.join(home, "tmp"),
      CODEX_HOME: home,
      CODEX_SQLITE_HOME: home,
      TERM: "dumb",
    };
    expect(rows[0]?.env).toEqual(rows[1]?.env);
    for (const row of rows) {
      const environment = { ...row.env };
      if (process.platform === "darwin") {
        expect(environment.__CF_USER_TEXT_ENCODING).toMatch(
          /^0x[0-9A-F]+:0x[0-9A-F]+:0x[0-9A-F]+$/i,
        );
        delete environment.__CF_USER_TEXT_ENCODING;
      }
      expect(environment).toEqual(expectedEnvironment);
    }
    expect(JSON.stringify(rows)).not.toContain(secrets[0]);
    expect(JSON.stringify(rows)).not.toContain(secrets[1]);
    expect(JSON.stringify(rows)).not.toContain(secrets[3]);
    expect(JSON.stringify(rows)).not.toContain(secrets[4]);
    expect(rows.some((row) => Object.hasOwn(row.env, "NODE_OPTIONS"))).toBe(false);
    assertGroupsGone();
  });

  it("sends exactly initialize, initialized and one state-only list, then closes normally", async () => {
    configure();
    const reply = await exchangeAppServer({ ...options(), kind: "list" });
    expect(reply.result).toMatchObject({
      data: [{ id: "synthetic-thread", source: "cli" }],
      nextCursor: null,
    });
    expect(reply.metrics.closed).toBe(true);
    expect(observations().map(({ method, id }) => ({ method, id }))).toEqual([
      { method: "initialize", id: 1 },
      { method: "initialized", id: null },
      { method: "thread/list", id: 2 },
    ]);
    expect(observations()[0]?.params).toMatchObject({
      clientInfo: { name: "cockpit", title: "Cockpit", version: "0.2.0" },
      capabilities: { experimentalApi: false },
    });
    expect(observations()[2]?.params).toMatchObject({ useStateDbOnly: true });
    assertGroupsGone();
  });

  it("binds read to the requested synthetic ID and independently accepted source", async () => {
    configure();
    const reply = await exchangeAppServer({
      ...options(),
      kind: "read",
      taskId: "synthetic-thread",
      copiedRowExists: true,
    });
    expect(reply.result).toMatchObject({
      thread: { id: "synthetic-thread", source: "cli", turns: [{ status: "completed" }] },
    });
    expect(observations().map((row) => row.method)).toEqual([
      "initialize",
      "initialized",
      "thread/read",
    ]);
    expect(observations()[2]?.params).toMatchObject({
      threadId: "synthetic-thread",
      includeTurns: true,
    });
    assertGroupsGone();
  });

  it.each(["allowed-notification", "four-notifications"])(
    "ignores only the bounded %s fixture",
    async (mode) => {
      configure(mode);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const reply = await exchangeAppServer({ ...options(), kind: "list" });
      expect(reply.result).toMatchObject({ data: [{ id: "synthetic-thread" }] });
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      assertGroupsGone();
    },
  );

  it("rejects the allowlisted notification when its params member is missing", async () => {
    const peer = writeModule(
      "missing-notification-params.mjs",
      `
      process.stdin.once("data", () => {
        process.stdout.write(JSON.stringify({ method: "remoteControl/status/changed" }) + "\\n");
      });
      process.stdin.resume();
    `,
    );
    await expect(exchangeAppServer({ ...options([peer]), kind: "list" })).rejects.toMatchObject({
      code: "protocol_violation",
    });
    assertGroupsGone();
  });

  it.each([
    "wrong-id",
    "string-id",
    "missing-id",
    "stale-id",
    "duplicate-id",
    "both-result-error",
    "server-request",
    "server-request-zero-id",
    "server-request-null-id",
    "unknown-notification",
    "notification-overflow",
    "invalid-json",
    "invalid-utf8",
    "wrong-home",
    "wrong-platform",
    "wrong-user-agent",
  ])("fails closed on initialize %s and reclaims the group", async (mode) => {
    configure(mode);
    await expect(exchangeAppServer({ ...options(), kind: "list" })).rejects.toMatchObject({
      code: "protocol_violation",
    });
    assertGroupsGone();
  });

  it.each([
    "wrong-id",
    "string-id",
    "stale-id",
    "duplicate-id",
    "both-result-error",
    "server-request",
  ])(
    "fails closed on operation %s rather than accepting a stale or alternate result",
    async (mode) => {
      configure(mode, { stage: "operation" });
      await expect(exchangeAppServer({ ...options(), kind: "list" })).rejects.toMatchObject({
        code: "protocol_violation",
      });
      assertGroupsGone();
    },
  );

  it.each(["wrong-thread-id", "excluded-source"])(
    "rejects read %s before returning content",
    async (mode) => {
      configure(mode);
      await expect(
        exchangeAppServer({
          ...options(),
          kind: "read",
          taskId: "synthetic-thread",
          copiedRowExists: true,
        }),
      ).rejects.toMatchObject({ code: "protocol_violation" });
      assertGroupsGone();
    },
  );

  it("rejects a matching read response when its selected copied row is missing", async () => {
    configure();
    await expect(
      exchangeAppServer({
        ...options(),
        kind: "read",
        taskId: "synthetic-thread",
        copiedRowExists: false,
      }),
    ).rejects.toMatchObject({ code: "protocol_violation" });
    if (groups.length) assertGroupsGone();
  });

  it.each(["oversize-line", "stdout-overflow", "stderr-overflow"])(
    "enforces the %s byte bound",
    async (mode) => {
      configure(mode);
      await expect(exchangeAppServer({ ...options(), kind: "list" })).rejects.toMatchObject({
        code: "resource_limit",
      });
      assertGroupsGone();
    },
  );

  it.each(["truncated-line", "early-exit", "message-overflow"])(
    "does not accept %s (flood may hit the earlier notification cap)",
    async (mode) => {
      configure(mode);
      const error = await exchangeAppServer({ ...options(), kind: "list" }).catch(
        (error: unknown) => error,
      );
      expect(error).toMatchObject({
        code: expect.stringMatching(/^(protocol_violation|source_unavailable)$/),
      });
      assertGroupsGone();
    },
  );

  it("never returns or logs the synthetic raw remote error", async () => {
    configure("remote-error");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = await exchangeAppServer({ ...options(), kind: "list" }).catch(
      (error: unknown) => error,
    );
    expect(error).toMatchObject({ code: "source_unavailable", message: "source_unavailable" });
    expect(JSON.stringify(error)).not.toContain("SYNTHETIC_PRIVATE_ERROR_MARKER");
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(logger).not.toHaveBeenCalled();
    assertGroupsGone();
  });

  it("stops on an over-limit aggregated RSS sample without claiming an OS memory measurement", async () => {
    configure("hang");
    const sampleGroup = vi.fn(async () => ({ rssKiB: 384 * 1024 + 1, members: 2 }));
    await expect(
      exchangeAppServer({ ...options(), sampleGroup, kind: "list" }),
    ).rejects.toMatchObject({ code: "resource_limit" });
    expect(sampleGroup).toHaveBeenCalled();
    assertGroupsGone();
  });

  it("stops after two failed group enumerations", async () => {
    configure("hang");
    const sampleGroup = vi.fn(async () => {
      throw new Error("SYNTHETIC_PRIVATE_ENUMERATION_MARKER");
    });
    await expect(
      exchangeAppServer({ ...options(), sampleGroup, kind: "list" }),
    ).rejects.toMatchObject({ code: "source_unavailable" });
    expect(sampleGroup).toHaveBeenCalledTimes(2);
    assertGroupsGone();
  });

  it("aborts before spawning any executable", async () => {
    configure();
    const abort = new AbortController();
    abort.abort();
    await expect(
      exchangeAppServer({ ...options(), kind: "list", signal: abort.signal }),
    ).rejects.toMatchObject({ code: "aborted" });
    expect(groups).toEqual([]);
    expect(observations()).toEqual([]);
  });

  it("aborts an active operation and reclaims its owned group", async () => {
    configure("hang", { stage: "operation" });
    const abort = new AbortController();
    const response = exchangeAppServer({ ...options(), kind: "list", signal: abort.signal });
    const rejection = expect(response).rejects.toMatchObject({ code: "aborted" });
    await waitForOperation();
    abort.abort();
    await rejection;
    assertGroupsGone();
  });

  it("times out a silent initialize rather than waiting indefinitely", async () => {
    configure("hang");
    await expect(exchangeAppServer({ ...options(), kind: "list" })).rejects.toMatchObject({
      code: "timeout",
    });
    assertGroupsGone();
  }, 8000);

  it("times out a silent list independently of the total lifetime", async () => {
    configure("hang", { stage: "operation" });
    await expect(exchangeAppServer({ ...options(), kind: "list" })).rejects.toMatchObject({
      code: "timeout",
    });
    assertGroupsGone();
  }, 6000);

  it("times out a silent read independently of the total lifetime", async () => {
    configure("hang", { stage: "operation" });
    await expect(
      exchangeAppServer({
        ...options(),
        kind: "read",
        taskId: "synthetic-thread",
        copiedRowExists: true,
      }),
    ).rejects.toMatchObject({ code: "timeout" });
    assertGroupsGone();
  }, 13000);

  it("does not wait indefinitely for a leader deliberately ignoring stdin EOF", async () => {
    configure("eof-hang");
    await expect(exchangeAppServer({ ...options(), kind: "list" })).rejects.toMatchObject({
      code: "source_unavailable",
    });
    assertGroupsGone();
  });

  it("does not kill a reclaimed group when a late RSS sample or old drain timer completes", async () => {
    configure("delayed-success", { delayMs: 350 });
    let resolveSample: (sample: { rssKiB: number; members: number }) => void = () => {};
    const sample = new Promise<{ rssKiB: number; members: number }>((resolve) => {
      resolveSample = resolve;
    });
    const sampleGroup = vi.fn(() => sample);
    const kill = vi.spyOn(process, "kill");
    try {
      await exchangeAppServer({ ...options(), sampleGroup, kind: "list" });
      expect(sampleGroup).toHaveBeenCalledTimes(1);
      const signalsBefore = kill.mock.calls.filter(
        ([, signal]) => signal === "SIGTERM" || signal === "SIGKILL",
      ).length;
      resolveSample({ rssKiB: 384 * 1024 + 1, members: 1 });
      await delay(700);
      expect(
        kill.mock.calls.filter(([, signal]) => signal === "SIGTERM" || signal === "SIGKILL"),
      ).toHaveLength(signalsBefore);
      assertGroupsGone();
    } finally {
      resolveSample({ rssKiB: 1, members: 0 });
    }
  });

  it("reclaims a same-group descendant retaining stdout after the leader exits", async () => {
    configure("descendant-hang");
    const outcome = await exchangeAppServer({ ...options(), kind: "list" }).catch(
      (error: unknown) => error,
    );
    if (outcome instanceof Error)
      expect(safeCodes).toContain((outcome as Error & { code: string }).code);
    else expect(outcome).toMatchObject({ result: { data: [{ id: "synthetic-thread" }] } });
    assertGroupsGone();
  }, 5000);
});
