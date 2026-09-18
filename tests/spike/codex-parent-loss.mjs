// Explicit macOS manual acceptance; never discovers an existing Codex home.
// node --conditions=react-server tests/spike/codex-parent-loss.mjs --executable /absolute/codex
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import Database from "better-sqlite3";

import { createOwnedTemp, reapOwnedTemps } from "../../src/server/codex/owned-temp.mjs";
import { sterileEnvironment } from "../../src/server/codex/owned-process.mjs";
import { probeVersion } from "../../src/server/codex/protocol.mjs";

const exec = promisify(execFile);
const hostFile = fileURLToPath(new URL("../helpers/codex-orphan-host.mjs", import.meta.url));
const POLICY = "(version 1) (allow default) (deny network-outbound)";
const SYSTEM_ENV = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C" };
const SAFE_HELPER_CODES = [
  "missing_source",
  "source_busy",
  "source_malformed",
  "source_too_large",
  "source_unavailable",
];
const HOUR = 3600000;
const owners = [];
const launches = [];
const sources = [];
const started = performance.now();
const counts = {
  hostSIGKILLCount: 0,
  eofExitCount: 0,
  helperEOFResponseCount: 0,
  livePreservedCount: 0,
  reapedCount: 0,
  forcedChildCleanupCount: 0,
  psChecks: 0,
  appServerEOFMs: 0,
  snapshotHelperEOFMs: 0,
  activeBackupAttemptCount: 0,
  activeBackupPassCount: 0,
  activeBackupRaceCount: 0,
  activeSourceBytes: 0,
  activeObservedDestinationBytes: 0,
  activeObservationMs: 0,
  activeBackupEOFMs: 0,
  activeWireFailureCount: 0,
  sourceFingerprintsUnchangedCount: 0,
  sourceTempsRemovedCount: 0,
  allTempRootsRemovedCount: 0,
  failureStage: 0,
  activeReplyCode: 0,
};
let base;
let parent;
let baseIdentity;
let version;
let failure = false;
let unverified = false;
let hardExpired = false;

function gone(pgid) {
  // Match the reaper: group disappearance alone does not prove its leader PID gone.
  for (const target of [pgid, -pgid]) {
    try {
      process.kill(target, 0);
      return false;
    } catch (error) {
      if (error.code !== "ESRCH") throw new Error();
    }
  }
  return true;
}

async function processIdentity(pid) {
  counts.psChecks++;
  let stdout;
  try {
    ({ stdout } = await exec(
      "/bin/ps",
      ["-p", String(pid), "-o", "pid=,ppid=,pgid=,uid=,lstart="],
      {
        env: SYSTEM_ENV,
        timeout: 1000,
        maxBuffer: 4096,
      },
    ));
  } catch (error) {
    if (error.code === 1 && !error.stdout?.trim()) return null;
    throw new Error();
  }
  const fields = stdout.trim().split(/\s+/);
  if (fields.length < 9 || fields.slice(0, 4).some((value) => !/^\d+$/.test(value)))
    throw new Error();
  return {
    pid: Number(fields[0]),
    ppid: Number(fields[1]),
    pgid: Number(fields[2]),
    uid: Number(fields[3]),
    start: fields.slice(4).join(" "),
  };
}

async function waitGone(pgid, ms = 2000) {
  const until = performance.now() + ms;
  do {
    if (gone(pgid)) return true;
    await delay(10);
  } while (performance.now() < until && !hardExpired);
  return false;
}

async function makeOwner() {
  const owner = createOwnedTemp({ parent });
  owners.push(owner);
  await fs.mkdir(path.join(owner.directory, "tmp"), { mode: 0o700 });
  return owner;
}

async function makeBulkSource(sizeMiB) {
  assert([128, 256].includes(sizeMiB));
  const directory = path.join(base, `source-${sizeMiB}`);
  await fs.mkdir(directory, { mode: 0o700 });
  const source = {
    directory,
    database: path.join(directory, "state_5.sqlite"),
    directoryIdentity: await fs.lstat(directory, { bigint: true }),
  };
  sources.push(source);
  const handle = await fs.open(source.database, "wx", 0o600);
  await handle.close();
  let writer;
  try {
    writer = new Database(source.database, { fileMustExist: true });
    writer.pragma("journal_mode = DELETE");
    writer.pragma("synchronous = OFF"); // Disposable synthetic fixture only.
    writer.exec(
      "CREATE TABLE threads(id TEXT PRIMARY KEY, rollout_path TEXT); CREATE TABLE filler(payload BLOB NOT NULL);",
    );
    writer
      .prepare("INSERT INTO threads(id, rollout_path) VALUES (?, NULL)")
      .run("55555555-5555-4555-8555-555555555555");
    const insert = writer.prepare("INSERT INTO filler(payload) VALUES (?)");
    const blob = Buffer.alloc(64 * 1024, 0x5a);
    const batch = writer.transaction(() => {
      for (let row = 0; row < 64; row++) insert.run(blob);
    });
    for (let index = 0; index < (sizeMiB === 128 ? 30 : 60); index++) batch();
  } finally {
    writer?.close();
  }
  source.databaseIdentity = await fs.lstat(source.database, { bigint: true });
  assert(
    source.databaseIdentity.size <= 256n * 1024n * 1024n &&
      source.databaseIdentity.size >= BigInt(sizeMiB - 8) * 1024n * 1024n,
  );
  source.bytes = Number(source.databaseIdentity.size);
  return source;
}

async function sourceFingerprint(source) {
  const stat = await fs.lstat(source.database, { bigint: true });
  assert(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.uid === BigInt(process.geteuid()) &&
      stat.dev === source.databaseIdentity.dev &&
      stat.ino === source.databaseIdentity.ino &&
      (await fs.realpath(source.database)) === source.database,
  );
  assert.deepEqual(await fs.readdir(source.directory), ["state_5.sqlite"]);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(source.database, { highWaterMark: 64 * 1024 }))
    hash.update(chunk);
  return [
    String(stat.dev),
    String(stat.ino),
    String(stat.size),
    String(stat.mtimeNs),
    hash.digest("hex"),
  ];
}

function killLiveHost(launch) {
  const host = launch.host;
  assert(host.exitCode === null && host.signalCode === null && !host.killed);
  launch.killed = true;
  assert(host.kill("SIGKILL"));
}

function privatePeer(host) {
  const queue = [];
  const waiters = [];
  let failed = false;
  let received = 0;
  host.on("message", (message) => {
    if (
      ++received > 8 ||
      Buffer.byteLength(JSON.stringify(message)) > 4096 ||
      !message ||
      typeof message !== "object" ||
      Array.isArray(message)
    )
      failed = true;
    if (message?.type === "failed") failed = true;
    const waiter = waiters.shift();
    if (waiter) waiter(failed ? null : message);
    else queue.push(failed ? null : message);
  });
  return async (expected) => {
    let timer;
    try {
      const message = await Promise.race([
        queue.length
          ? Promise.resolve(queue.shift())
          : new Promise((resolve) => waiters.push(resolve)),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(null), 5000);
        }),
      ]);
      if (!message || message.type !== expected || failed || hardExpired) throw new Error();
      return message;
    } finally {
      clearTimeout(timer);
    }
  };
}

async function runCase(command, kind, activeSource) {
  const owner = await makeOwner();
  const host = spawn(process.execPath, ["--conditions=react-server", hostFile], {
    cwd: owner.directory,
    env: sterileEnvironment(owner.directory),
    shell: false,
    detached: true,
    stdio: ["ignore", "pipe", "pipe", "ipc", "pipe", "pipe"],
  });
  assert(Number.isInteger(host.pid));
  const launch = { host, owner, child: null, killed: false, badWire: false };
  launches.push(launch);
  host.on("error", () => {
    launch.badWire = true;
  });
  const exit = new Promise((resolve) => {
    host.once("exit", (code, signal) => resolve({ code, signal }));
    host.once("error", () => resolve(null));
  });
  const receive = privatePeer(host);
  const nodeIdentity = await fs.stat(await fs.realpath(process.execPath), { bigint: true });
  const hostIdentity = await processIdentity(host.pid);
  assert(
    hostIdentity?.pid === host.pid &&
      hostIdentity.ppid === process.pid &&
      hostIdentity.pgid === host.pid &&
      hostIdentity.uid === process.geteuid(),
  );
  launch.hostIdentity = hostIdentity;
  owner.recordProcess({
    pid: host.pid,
    pgid: host.pid,
    executableIdentity: `${nodeIdentity.dev}:${nodeIdentity.ino}:${nodeIdentity.size}`,
    startToken: hostIdentity.start,
  });
  let hostBytes = 0;
  for (const stream of [host.stdout, host.stderr])
    stream.on("data", (bytes) => {
      hostBytes += bytes.length;
      if (hostBytes > 4096) launch.badWire = true;
    });
  let rawBytes = 0;
  let stderrBytes = 0;
  let partial = Buffer.alloc(0);
  let notificationCount = 0;
  let initializeCount = 0;
  let helperReplies = 0;
  let helperResult;
  const outputEnded = new Promise((resolve) => host.stdio[4].once("end", resolve));
  host.stdio[4].on("data", (bytes) => {
    try {
      rawBytes += bytes.length;
      if (rawBytes > 17 * 1024 * 1024) throw new Error();
      partial = Buffer.concat([partial, bytes]);
      while (partial.includes(10)) {
        const newline = partial.indexOf(10);
        if (newline > 16 * 1024 * 1024) throw new Error();
        const message = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(partial.subarray(0, newline)),
        );
        partial = partial.subarray(newline + 1);
        if (kind === "snapshot-helper") {
          assert(helperReplies++ === 0);
          helperResult = message;
          if (activeSource) {
            counts.activeReplyCode =
              message.ok === true ? 1 : SAFE_HELPER_CODES.indexOf(message.code) + 2;
            assert(
              (message.ok === true && Object.keys(message).length === 1) ||
                (message.ok === false &&
                  Object.keys(message).length === 2 &&
                  SAFE_HELPER_CODES.includes(message.code)),
            );
          } else
            assert(
              launch.killed &&
                message.ok === false &&
                message.code === "source_malformed" &&
                Object.keys(message).length === 2,
            );
        } else if (Object.hasOwn(message, "method")) {
          assert(
            !Object.hasOwn(message, "id") &&
              message.method === "remoteControl/status/changed" &&
              ++notificationCount <= 4,
          );
        } else {
          assert(
            message.id === 1 &&
              Object.hasOwn(message, "result") &&
              !Object.hasOwn(message, "error") &&
              initializeCount++ === 0,
          );
          const result = message.result;
          assert(
            result.codexHome === owner.directory &&
              result.platformFamily === "unix" &&
              result.platformOs === "macos" &&
              /^cockpit\/0\.145\.0 \(Mac OS [0-9]+(?:\.[0-9]+)*; (arm64|x86_64)\) dumb \(cockpit; 0\.2\.0\)$/.test(
                result.userAgent,
              ),
          );
          host.send({ type: "initializeAccepted" });
        }
      }
      if (partial.length > 16 * 1024 * 1024) throw new Error();
    } catch {
      launch.badWire = true;
      if (activeSource) counts.activeWireFailureCount++;
    }
  });
  host.stdio[5].on("data", (bytes) => {
    stderrBytes += bytes.length;
    if (stderrBytes > 64 * 1024) launch.badWire = true;
  });
  host.send({ type: "configuration", kind, executable: command });
  const spawned = await receive("childSpawned");
  const child = spawned.record;
  assert(child?.pid > 1 && child.pgid === child.pid && child.pid !== host.pid);
  // Preserve even a pre-readiness child in the owner before a capability check
  // can fail. The private host's spawn record is never an external/browser input.
  launch.child = { ...child, identity: null };
  owner.recordProcess(child);
  const childIdentity = await processIdentity(child.pid);
  assert(
    childIdentity?.pid === child.pid &&
      childIdentity.ppid === host.pid &&
      childIdentity.pgid === child.pgid &&
      childIdentity.uid === process.geteuid(),
  );
  launch.child = { ...child, identity: childIdentity };
  host.send({ type: "ownershipAccepted" });
  await receive("ready");
  // Keep the waiting worker/initialized server alive before the host is killed.
  await delay(300);
  assert(!launch.badWire && !hardExpired && !gone(child.pgid));
  assert(owner.cleanup() === false);
  const clock = Date.now() + HOUR + 2000;
  assert(reapOwnedTemps({ parent, now: clock }).removed === 0);
  assert(await fs.stat(owner.directory));
  counts.livePreservedCount++;
  const checkedHost = await processIdentity(host.pid);
  const checkedChild = await processIdentity(child.pid);
  assert(
    checkedHost?.start === hostIdentity.start &&
      checkedHost.ppid === process.pid &&
      checkedHost.pgid === host.pid &&
      checkedHost.uid === process.geteuid() &&
      checkedChild?.start === childIdentity.start &&
      checkedChild.ppid === host.pid &&
      checkedChild.pgid === child.pid &&
      checkedChild.uid === process.geteuid(),
  );
  let activeObserved = false;
  if (activeSource) {
    counts.activeBackupAttemptCount++;
    counts.activeSourceBytes = activeSource.bytes;
    counts.activeObservedDestinationBytes = 0;
    counts.activeObservationMs = 0;
    counts.activeReplyCode = 0;
    const observeStarted = performance.now();
    const destinationDatabase = path.join(owner.directory, "state_5.sqlite");
    host.send({
      type: "startBackup",
      input: {
        sourceDatabase: activeSource.database,
        destinationDatabase,
        placeholder: path.join(owner.directory, "list-placeholder.jsonl"),
      },
    });
    await receive("backupStarted");
    const until = observeStarted + 3000;
    while (performance.now() < until && !hardExpired && !launch.badWire && !helperResult) {
      try {
        const stat = await fs.lstat(destinationDatabase);
        assert(
          stat.isFile() &&
            !stat.isSymbolicLink() &&
            stat.uid === process.geteuid() &&
            stat.size <= activeSource.bytes,
        );
        if (stat.size > 0 && stat.size < activeSource.bytes) {
          counts.activeObservedDestinationBytes = stat.size;
          activeObserved = true;
          break;
        }
        if (stat.size >= activeSource.bytes) break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await delay(1);
    }
    counts.activeObservationMs = Math.round(performance.now() - observeStarted);
  }
  const killedAt = performance.now();
  counts.failureStage = 1;
  killLiveHost(launch); // Child owns a different PGID: this is HOST loss.
  counts.hostSIGKILLCount++;
  const hostExit = await exit;
  counts.failureStage = 2;
  assert(hostExit?.signal === "SIGKILL" && hostExit.code === null);
  assert(await waitGone(child.pgid));
  counts.failureStage = 3;
  const eofMs = Math.round(performance.now() - killedAt);
  assert(eofMs <= 2000 && gone(host.pid));
  let drainTimer;
  try {
    await Promise.race([
      outputEnded,
      new Promise((_, reject) => {
        drainTimer = setTimeout(() => reject(new Error()), 250);
      }),
    ]);
  } finally {
    clearTimeout(drainTimer);
  }
  assert(!launch.badWire && partial.length === 0);
  counts.failureStage = 4;
  let activeVerdict = "PASS";
  if (activeSource) {
    assert(helperReplies === 1);
    if (helperResult.ok === true) activeVerdict = "RACE";
    else if (!activeObserved) activeVerdict = "UNVERIFIED";
    else {
      // Once the host is gone no application request can consume this result.
      // The safety contract is bounded exit, an allowlisted result, unchanged
      // source bytes and validated stale cleanup—not one incidental EOF code.
      assert(helperResult.ok === false && SAFE_HELPER_CODES.includes(helperResult.code));
      counts.activeBackupPassCount++;
      counts.activeBackupEOFMs = eofMs;
      counts.eofExitCount++;
    }
  } else if (kind === "snapshot-helper") {
    counts.eofExitCount++;
    assert(helperReplies === 1);
    counts.helperEOFResponseCount++;
    counts.snapshotHelperEOFMs = eofMs;
  } else {
    counts.eofExitCount++;
    assert(initializeCount === 1);
    counts.appServerEOFMs = eofMs;
  }
  counts.failureStage = 5;
  assert(reapOwnedTemps({ parent, now: clock }).removed === 1);
  counts.reapedCount++;
  counts.failureStage = 0;
  return activeVerdict;
}

const hardDeadline = setTimeout(() => {
  hardExpired = true;
  for (const launch of launches) {
    if (!launch.killed && launch.host.exitCode === null && launch.host.signalCode === null) {
      try {
        killLiveHost(launch);
      } catch {}
    }
  }
}, 30000);

try {
  assert.equal(process.platform, "darwin");
  assert(typeof process.geteuid === "function" && process.geteuid() > 0);
  assert.deepEqual(process.argv.slice(2, 3), ["--executable"]);
  assert.equal(process.argv.length, 4);
  const command = await fs.realpath(process.argv[3]);
  assert(path.isAbsolute(command));
  base = await fs.realpath(
    await fs.mkdtemp(path.join(await fs.realpath("/tmp"), "cockpit-parent-loss-")),
  );
  await fs.chmod(base, 0o700);
  baseIdentity = await fs.lstat(base, { bigint: true });
  parent = path.join(base, "operations");
  const probe = await makeOwner();
  version = (
    await probeVersion({
      command: "/usr/bin/sandbox-exec",
      argvPrefix: ["-p", POLICY, command],
      home: probe.directory,
      owner: probe,
    })
  ).version;
  assert.equal(version, "0.145.0");
  assert(probe.cleanup());
  await runCase(command, "app-server");
  await runCase(command, "snapshot-helper");
  for (const sizeMiB of [128, 256]) {
    const source = await makeBulkSource(sizeMiB);
    const before = await sourceFingerprint(source);
    const verdict = await runCase(command, "snapshot-helper", source);
    assert.deepEqual(await sourceFingerprint(source), before);
    counts.sourceFingerprintsUnchangedCount++;
    if (verdict === "PASS") break;
    if (verdict === "RACE") {
      counts.activeBackupRaceCount++;
      continue;
    }
    unverified = true;
    break;
  }
  if (counts.activeBackupPassCount !== 1) unverified = true;
} catch {
  failure = true;
} finally {
  clearTimeout(hardDeadline);
  // Only groups created by this launcher/its private host are eligible for teardown.
  for (const launch of launches) {
    try {
      if (launch.host.exitCode === null && launch.host.signalCode === null && !launch.host.killed)
        killLiveHost(launch);
      if (launch.child && !(await waitGone(launch.child.pgid))) {
        counts.forcedChildCleanupCount++;
        failure = true;
        process.kill(-launch.child.pgid, "SIGKILL");
        await waitGone(launch.child.pgid);
      }
      if (launch.host.connected) launch.host.disconnect();
    } catch {
      failure = true;
    }
  }
  const removed = await Promise.all(
    owners.map(async (owner) => {
      try {
        await fs.lstat(owner.directory);
        return owner.cleanup();
      } catch (error) {
        return error.code === "ENOENT";
      }
    }),
  );
  const cleaned = removed.every(Boolean);
  if (cleaned)
    for (const source of sources) {
      try {
        const directory = await fs.lstat(source.directory, { bigint: true });
        const database = await fs.lstat(source.database, { bigint: true });
        assert(
          directory.dev === source.directoryIdentity.dev &&
            directory.ino === source.directoryIdentity.ino &&
            directory.uid === BigInt(process.geteuid()) &&
            directory.isDirectory() &&
            !directory.isSymbolicLink() &&
            database.isFile() &&
            !database.isSymbolicLink() &&
            database.uid === BigInt(process.geteuid()),
        );
        await fs.unlink(source.database);
        await fs.rmdir(source.directory);
        counts.sourceTempsRemovedCount++;
      } catch {
        failure = true;
      }
    }
  if (base && cleaned) {
    try {
      const current = await fs.lstat(base, { bigint: true });
      assert(
        current.dev === baseIdentity.dev &&
          current.ino === baseIdentity.ino &&
          current.uid === BigInt(process.geteuid()) &&
          current.isDirectory() &&
          !current.isSymbolicLink(),
      );
      try {
        await fs.rmdir(parent);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await fs.rmdir(base);
      counts.allTempRootsRemovedCount++;
    } catch {
      failure = true;
    }
  }
  if (!cleaned || hardExpired) failure = true;
  process.exitCode = failure || unverified ? 1 : 0;
  console.log(
    JSON.stringify({
      verdict: failure ? "FAIL" : unverified ? "UNVERIFIED" : "PASS",
      version: version === "0.145.0" ? version : null,
      elapsedMs: Math.round(performance.now() - started),
      ...counts,
      ownedTempsRemovedCount: removed.filter(Boolean).length,
    }),
  );
}
