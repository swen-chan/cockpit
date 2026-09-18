import "server-only";

import { spawn, execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { CODEX_LIMITS } from "./limits.mjs";

const exec = promisify(execFile);
const SYSTEM_ENV = Object.freeze({ PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C" });
const fail = (code) => Object.assign(new Error(code), { code });
const SAFE_CODES = new Set([
  "protocol_violation",
  "resource_limit",
  "timeout",
  "aborted",
  "source_unavailable",
  "source_busy",
  "missing_source",
  "source_malformed",
  "source_too_large",
  "unsupported_runtime_version",
]);

export function sterileEnvironment(home, app = true) {
  return {
    ...SYSTEM_ENV,
    HOME: home,
    TMPDIR: path.join(home, "tmp"),
    ...(app ? { CODEX_HOME: home, CODEX_SQLITE_HOME: home, TERM: "dumb" } : {}),
  };
}

export async function sampleOwnedGroup(pgid) {
  let stdout;
  try {
    ({ stdout } = await exec("/bin/ps", ["-axo", "pid=,pgid=,rss="], {
      env: SYSTEM_ENV,
      timeout: 1000,
      maxBuffer: 512 * 1024,
    }));
  } catch {
    throw fail("source_unavailable");
  }
  let rssKiB = 0;
  let members = 0;
  for (const line of stdout.trim().split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line);
    if (!match) throw fail("source_unavailable");
    if (Number(match[2]) === pgid) {
      members++;
      rssKiB += Number(match[3]);
    }
  }
  return { rssKiB, members };
}

function groupAlive(pgid) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

// One internally constructed process. No shell, inherited env, shared child, or queue.
export async function runOwnedProcess({
  command,
  args,
  home,
  app = true,
  owner,
  signal,
  lifetimeMs,
  stdoutCap = CODEX_LIMITS.stdoutBytes,
  stderrCap = CODEX_LIMITS.stderrBytes,
  combinedCap,
  onData,
  onStart,
  onEnd,
  sampleGroup = sampleOwnedGroup,
}) {
  if (process.platform !== "darwin" && process.platform !== "linux")
    throw fail("source_unavailable");
  if (signal?.aborted) throw fail("aborted");
  let executable;
  let info;
  try {
    executable = await realpath(command);
    info = await stat(executable, { bigint: true });
  } catch {
    throw fail("source_unavailable");
  }
  if (!info.isFile()) throw fail("source_unavailable");
  let child;
  try {
    child = spawn(executable, args, {
      cwd: home,
      env: sterileEnvironment(home, app),
      detached: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    throw fail("source_unavailable");
  }
  if (!Number.isInteger(child.pid)) {
    child.on("error", () => {});
    child.stdin?.destroy();
    child.stdout?.destroy();
    child.stderr?.destroy();
    throw fail("source_unavailable");
  }
  const pgid = child.pid;
  let exited = false;
  let disposed = false;
  let closed = false;
  let exitCode;
  let failure;
  let completed = false;
  let value;
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let peakRssKiB = 0;
  let samples = 0;
  let badSamples = 0;
  let sampling = false;
  let stageTimer;
  let closeTimer;
  let termTimer;
  let drainTimer;
  const exit = new Promise((resolve) => {
    child.once("error", () => {
      failure ??= fail("source_unavailable");
      exited = true;
      resolve();
    });
    child.once("exit", (code) => {
      exited = true;
      exitCode = code;
      resolve();
    });
  });
  const streamClose = new Promise((resolve) =>
    child.once("close", () => {
      closed = true;
      resolve();
    }),
  );
  function killGroup(signalName) {
    try {
      process.kill(-pgid, signalName);
    } catch (error) {
      if (error.code !== "ESRCH") failure ??= fail("source_unavailable");
    }
  }
  function terminate() {
    child.stdin.destroy();
    killGroup("SIGTERM");
    termTimer ??= setTimeout(() => killGroup("SIGKILL"), CODEX_LIMITS.termGraceMs);
  }
  function stop(code) {
    failure ??= fail(SAFE_CODES.has(code) ? code : "protocol_violation");
    terminate();
  }
  function deadline(ms) {
    clearTimeout(stageTimer);
    stageTimer = setTimeout(() => stop("timeout"), ms);
  }
  const api = {
    send(message) {
      if (failure || completed || exited) throw fail("protocol_violation");
      child.stdin.write(JSON.stringify(message) + "\n");
    },
    complete(result) {
      if (completed || failure) throw fail("protocol_violation");
      completed = true;
      value = result;
      clearTimeout(stageTimer);
      child.stdin.end();
      closeTimer = setTimeout(terminate, CODEX_LIMITS.stdinGraceMs);
    },
    deadline,
    stop,
  };
  const abort = () => stop("aborted");
  const lifetime = setTimeout(() => stop("timeout"), lifetimeMs);
  const watcher = setInterval(async () => {
    if (sampling || failure || exited) return;
    sampling = true;
    try {
      const sample = await sampleGroup(pgid);
      if (disposed || exited || failure) return;
      if (
        !Number.isSafeInteger(sample.rssKiB) ||
        sample.rssKiB < 0 ||
        !Number.isSafeInteger(sample.members) ||
        sample.members < 0
      )
        throw fail("source_unavailable");
      peakRssKiB = Math.max(peakRssKiB, sample.rssKiB);
      samples++;
      badSamples = 0;
      if (sample.rssKiB > CODEX_LIMITS.rssKiB) stop("resource_limit");
    } catch {
      if (!disposed && !exited && !failure && ++badSamples >= 2) stop("source_unavailable");
    } finally {
      sampling = false;
    }
  }, CODEX_LIMITS.sampleMs);
  signal?.addEventListener("abort", abort, { once: true });
  child.stdin.on("error", () => {
    if (!completed && !failure) stop("source_unavailable");
  });
  child.stdout.on("data", (bytes) => {
    stdoutBytes += bytes.length;
    if (
      stdoutBytes > stdoutCap ||
      (combinedCap !== undefined && stdoutBytes + stderrBytes > combinedCap)
    )
      return stop("resource_limit");
    if (failure) return;
    try {
      onData(bytes, api);
    } catch (error) {
      stop(
        ["resource_limit", "source_unavailable", "unsupported_runtime_version"].includes(error.code)
          ? error.code
          : "protocol_violation",
      );
    }
  });
  child.stderr.on("data", (bytes) => {
    stderrBytes += bytes.length;
    if (
      stderrBytes > stderrCap ||
      (combinedCap !== undefined && stdoutBytes + stderrBytes > combinedCap)
    )
      stop("resource_limit");
  });
  try {
    await owner?.recordProcess({
      pid: pgid,
      pgid,
      executableIdentity: `${info.dev}:${info.ino}:${info.size}`,
      startToken: String(performance.now()),
    });
    if (signal?.aborted) abort();
    if (!failure) onStart(api);
    await exit;
    // The leader may exit while a descendant retains its pipes. Always reclaim its group.
    if (groupAlive(pgid)) terminate();
    await Promise.race([
      streamClose,
      new Promise((resolve) => {
        drainTimer = setTimeout(() => {
          killGroup("SIGKILL");
          child.stdout.destroy();
          child.stderr.destroy();
          resolve();
        }, CODEX_LIMITS.termGraceMs + 100);
      }),
    ]);
    clearTimeout(drainTimer);
    if (groupAlive(pgid)) {
      killGroup("SIGKILL");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (groupAlive(pgid)) throw fail("source_unavailable");
    if (failure) throw failure;
    onEnd?.(api);
    if (!completed || exitCode !== 0) throw fail("source_unavailable");
    return { value, metrics: { stdoutBytes, stderrBytes, peakRssKiB, samples, closed } };
  } catch (error) {
    throw fail(SAFE_CODES.has(error.code) ? error.code : "source_unavailable");
  } finally {
    disposed = true;
    clearTimeout(lifetime);
    clearInterval(watcher);
    clearTimeout(stageTimer);
    clearTimeout(closeTimer);
    clearTimeout(termTimer);
    clearTimeout(drainTimer);
    signal?.removeEventListener("abort", abort);
    if (!exited || groupAlive(pgid)) {
      child.stdin.destroy();
      killGroup("SIGKILL");
    }
    child.stdout.destroy();
    child.stderr.destroy();
    // Also drain early callback/marker failures before the owner may remove its home.
    if (!exited) {
      let cleanupTimer;
      await Promise.race([
        exit,
        new Promise((resolve) => {
          cleanupTimer = setTimeout(resolve, 600);
        }),
      ]);
      clearTimeout(cleanupTimer);
    }
  }
}
