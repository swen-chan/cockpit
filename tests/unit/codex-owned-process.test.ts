// @vitest-environment node
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CODEX_LIMITS } from "@/server/codex/limits.mjs";
import { runOwnedProcess } from "@/server/codex/owned-process.mjs";
import { probeVersion } from "@/server/codex/protocol.mjs";

describe("owned worker lifecycle failures", () => {
  let home: string;
  let groups: number[];
  beforeEach(() => {
    home = realpathSync(mkdtempSync(path.join(realpathSync("/tmp"), "cockpit-worker-life-")));
    chmodSync(home, 0o700);
    mkdirSync(path.join(home, "tmp"), { mode: 0o700 });
    groups = [];
  });
  afterEach(() => {
    for (const pgid of groups) {
      try {
        process.kill(-pgid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
    rmSync(home, { recursive: true, force: true });
  });
  function options() {
    return {
      command: process.execPath,
      args: ["-e", "process.stdin.resume()"],
      home,
      lifetimeMs: CODEX_LIMITS.helperMs,
      sampleGroup: async () => ({ rssKiB: 1, members: 1 }),
      owner: {
        recordProcess(record: { pgid: number }) {
          groups.push(record.pgid);
        },
      },
      onData() {},
      onStart() {},
    };
  }
  function assertGone() {
    expect(groups.length).toBeGreaterThan(0);
    for (const pgid of groups)
      expect(() => process.kill(-pgid, 0)).toThrowError(expect.objectContaining({ code: "ESRCH" }));
  }
  it("hides a missing executable path in the safe error", async () => {
    const error = await runOwnedProcess({
      ...options(),
      command: path.join(home, "SYNTHETIC_PRIVATE_PATH"),
    }).catch((error) => error);
    expect(error).toMatchObject({ code: "source_unavailable", message: "source_unavailable" });
    expect(JSON.stringify(error)).not.toContain("SYNTHETIC_PRIVATE_PATH");
    expect(groups).toEqual([]);
  });
  it("handles asynchronous spawn EACCES without an unhandled error", async () => {
    const command = path.join(home, "not-executable");
    writeFileSync(command, "synthetic", { mode: 0o600 });
    await expect(runOwnedProcess({ ...options(), command })).rejects.toMatchObject({
      code: "source_unavailable",
    });
    expect(groups).toEqual([]);
  });
  it("reclaims a child before returning an early start callback failure", async () => {
    await expect(
      runOwnedProcess({
        ...options(),
        onStart() {
          throw new Error("SYNTHETIC_PRIVATE_START_ERROR");
        },
      }),
    ).rejects.toMatchObject({ code: "source_unavailable", message: "source_unavailable" });
    assertGone();
  });
  it("reclaims a child before returning a marker update failure", async () => {
    await expect(
      runOwnedProcess({
        ...options(),
        owner: {
          recordProcess(record: { pgid: number }) {
            groups.push(record.pgid);
            throw new Error("SYNTHETIC_PRIVATE_MARKER_ERROR");
          },
        },
      }),
    ).rejects.toMatchObject({ code: "source_unavailable", message: "source_unavailable" });
    assertGone();
  });
  it("enforces the real five-second helper lifetime for a blocked worker", async () => {
    const start = performance.now();
    await expect(runOwnedProcess(options())).rejects.toMatchObject({ code: "timeout" });
    expect(performance.now() - start).toBeLessThan(CODEX_LIMITS.helperMs + 1500);
    assertGone();
  }, 7500);
  it("enforces the exact five-second version timeout", async () => {
    writeFileSync(path.join(home, "fixture-mode.json"), JSON.stringify({ mode: "version-hang" }), {
      mode: 0o600,
    });
    expect(CODEX_LIMITS.probeMs).toBe(5_000);
    const start = performance.now();
    await expect(
      probeVersion({
        ...options(),
        argvPrefix: [fileURLToPath(new URL("../helpers/codex-fake.mjs", import.meta.url))],
      }),
    ).rejects.toMatchObject({ code: "timeout" });
    expect(performance.now() - start).toBeLessThan(CODEX_LIMITS.probeMs + 1500);
    assertGone();
  }, 7500);
  it.each([
    { stream: "stdout", cap: CODEX_LIMITS.helperBytes },
    { stream: "stderr", cap: CODEX_LIMITS.stderrBytes },
  ])("enforces the worker $stream cap", async ({ stream, cap }) => {
    await expect(
      runOwnedProcess({
        ...options(),
        stdoutCap: CODEX_LIMITS.helperBytes,
        args: ["-e", `process.${stream}.write('x'.repeat(${cap + 1}));process.stdin.resume()`],
      }),
    ).rejects.toMatchObject({ code: "resource_limit" });
    assertGone();
  });
});
