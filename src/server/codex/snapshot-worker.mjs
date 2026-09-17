import "server-only";

import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

import { CODEX_LIMITS } from "./limits.mjs";
import { assertOwnedTempDirectory } from "./owned-temp.mjs";
import { copyStableRollout } from "./stable-copy.mjs";

const INPUT_KEYS = new Set([
  "sourceDatabase",
  "selectedTaskId",
  "allowedRolloutRoots",
  "destinationDatabase",
  "destinationRollout",
  "placeholder",
]);
const VERIFY_INPUT_KEYS = new Set(["operation", "database", "rollout", "taskId"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_CODES = new Set([
  "missing_source",
  "protocol_violation",
  "source_busy",
  "source_malformed",
  "source_too_large",
  "source_unavailable",
]);
const fail = (code) => Object.freeze({ code });
const sameIdentity = (left, right) => left.dev === right.dev && left.ino === right.ino;
const sameStableFile = (left, right) =>
  sameIdentity(left, right) && left.size === right.size && left.mtimeNs === right.mtimeNs;
const contained = (root, candidate) =>
  candidate === root || candidate.startsWith(`${root}${path.sep}`);
const validPath = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 4096 &&
  !/[\x00-\x1f\x7f]/.test(value) &&
  path.isAbsolute(value) &&
  path.normalize(value) === value;

function safeCode(error) {
  if (SAFE_CODES.has(error?.code)) return error.code;
  if (error?.code === "ENOENT") return "missing_source";
  if (/^SQLITE_(BUSY|LOCKED)/.test(error?.code ?? "")) return "source_busy";
  if (/^SQLITE_(NOTADB|CORRUPT|FORMAT|SCHEMA|ERROR|MISMATCH)/.test(error?.code ?? ""))
    return "source_malformed";
  return "source_unavailable";
}

async function regularOwned(filename, ownerUid, maximum) {
  const stat = await lstat(filename, { bigint: true });
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.uid !== ownerUid ||
    (await realpath(filename)) !== filename
  ) {
    throw fail("source_unavailable");
  }
  if (stat.size > BigInt(maximum)) throw fail("source_too_large");
  return stat;
}

async function optionalRegularOwned(filename, ownerUid, maximum) {
  try {
    return await regularOwned(filename, ownerUid, maximum);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function digestStableFile(filename, expected, ownerUid, maximum, checkWork) {
  let handle;
  try {
    handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat({ bigint: true });
    if (!sameStableFile(expected, opened)) throw fail("source_busy");
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    while (offset < Number(opened.size)) {
      checkWork();
      const requested = Math.min(buffer.length, Number(opened.size) - offset);
      const { bytesRead } = await handle.read(buffer, 0, requested, offset);
      if (bytesRead !== requested) throw fail("source_busy");
      digest.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const named = await regularOwned(filename, ownerUid, maximum);
    if (!sameStableFile(opened, after) || !sameStableFile(after, named)) throw fail("source_busy");
    return digest.digest("hex");
  } catch (error) {
    if (error?.code === "ENOENT") throw fail("source_busy");
    throw error;
  } finally {
    await handle?.close();
  }
}

async function preflight(sourceDatabase, ownerUid, checkWork) {
  const mainStat = await regularOwned(sourceDatabase, ownerUid, CODEX_LIMITS.databaseBytes);
  const walStat = await optionalRegularOwned(
    `${sourceDatabase}-wal`,
    ownerUid,
    CODEX_LIMITS.databaseBytes,
  );
  const shmStat = await optionalRegularOwned(
    `${sourceDatabase}-shm`,
    ownerUid,
    CODEX_LIMITS.shmBytes,
  );
  if (mainStat.size + (walStat?.size ?? 0n) > BigInt(CODEX_LIMITS.databaseBytes)) {
    throw fail("source_too_large");
  }
  const main = Object.freeze({
    stat: mainStat,
    digest: await digestStableFile(
      sourceDatabase,
      mainStat,
      ownerUid,
      CODEX_LIMITS.databaseBytes,
      checkWork,
    ),
  });
  const wal =
    walStat === null
      ? Object.freeze({ state: "missing" })
      : walStat.size === 0n
        ? Object.freeze({ state: "empty", stat: walStat })
        : Object.freeze({
            state: "nonempty",
            stat: walStat,
            digest: await digestStableFile(
              `${sourceDatabase}-wal`,
              walStat,
              ownerUid,
              CODEX_LIMITS.databaseBytes,
              checkWork,
            ),
          });
  const shm =
    shmStat === null
      ? Object.freeze({ state: "missing" })
      : Object.freeze({ state: "present", stat: shmStat });
  return Object.freeze({ main, wal, shm });
}

async function postflight(sourceDatabase, ownerUid, before, checkWork, { content = true } = {}) {
  try {
    checkWork();
    const main = await regularOwned(sourceDatabase, ownerUid, CODEX_LIMITS.databaseBytes);
    if (!sameStableFile(before.main.stat, main)) throw fail("source_busy");
    if (
      content &&
      (await digestStableFile(
        sourceDatabase,
        main,
        ownerUid,
        CODEX_LIMITS.databaseBytes,
        checkWork,
      )) !== before.main.digest
    )
      throw fail("source_busy");

    const wal = await optionalRegularOwned(
      `${sourceDatabase}-wal`,
      ownerUid,
      CODEX_LIMITS.databaseBytes,
    );
    if (before.wal.state === "nonempty") {
      if (wal === null || !sameStableFile(before.wal.stat, wal)) throw fail("source_busy");
      if (
        content &&
        (await digestStableFile(
          `${sourceDatabase}-wal`,
          wal,
          ownerUid,
          CODEX_LIMITS.databaseBytes,
          checkWork,
        )) !== before.wal.digest
      )
        throw fail("source_busy");
    } else if (wal !== null && wal.size !== 0n) throw fail("source_busy");
    if (main.size + (wal?.size ?? 0n) > BigInt(CODEX_LIMITS.databaseBytes))
      throw fail("source_too_large");

    const shm = await optionalRegularOwned(
      `${sourceDatabase}-shm`,
      ownerUid,
      CODEX_LIMITS.shmBytes,
    );
    if (before.shm.state === "present" && (shm === null || !sameIdentity(before.shm.stat, shm))) {
      throw fail("source_busy");
    }
  } catch (error) {
    if (error?.code === "ENOENT") throw fail("source_busy");
    throw error;
  }
}

function checkInput(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !INPUT_KEYS.has(key))
  )
    throw fail("source_malformed");
  const {
    sourceDatabase,
    destinationDatabase,
    placeholder,
    selectedTaskId,
    destinationRollout,
    allowedRolloutRoots,
  } = input;
  if (
    ![sourceDatabase, destinationDatabase, placeholder].every(validPath) ||
    path.basename(sourceDatabase) !== "state_5.sqlite" ||
    path.basename(destinationDatabase) !== "state_5.sqlite" ||
    path.extname(placeholder) !== ".jsonl"
  )
    throw fail("source_malformed");
  const reading = selectedTaskId !== undefined;
  if (
    reading
      ? typeof selectedTaskId !== "string" ||
        !UUID.test(selectedTaskId) ||
        !validPath(destinationRollout) ||
        path.extname(destinationRollout) !== ".jsonl" ||
        !Array.isArray(allowedRolloutRoots) ||
        allowedRolloutRoots.length < 1 ||
        allowedRolloutRoots.length > 2 ||
        !allowedRolloutRoots.every(validPath)
      : destinationRollout !== undefined || allowedRolloutRoots !== undefined
  )
    throw fail("source_malformed");
  const directory = path.dirname(destinationDatabase);
  const outputs = [destinationDatabase, placeholder, ...(reading ? [destinationRollout] : [])];
  if (
    new Set(outputs).size !== outputs.length ||
    outputs.some((filename) => path.dirname(filename) !== directory) ||
    contained(path.dirname(sourceDatabase), directory)
  )
    throw fail("source_unavailable");
  if (
    reading &&
    allowedRolloutRoots.some(
      (root) =>
        !["sessions", "archived_sessions"].some(
          (name) => root === path.join(path.dirname(sourceDatabase), name),
        ),
    )
  )
    throw fail("source_unavailable");
  assertOwnedTempDirectory(directory);
  return { directory, reading };
}

function checkVerifyInput(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== VERIFY_INPUT_KEYS.size ||
    Object.keys(input).some((key) => !VERIFY_INPUT_KEYS.has(key)) ||
    input.operation !== "verify-copied-task" ||
    !validPath(input.database) ||
    !validPath(input.rollout) ||
    typeof input.taskId !== "string" ||
    !UUID.test(input.taskId) ||
    path.basename(input.database) !== "state_5.sqlite" ||
    path.basename(input.rollout) !== "selected.jsonl" ||
    input.database === input.rollout ||
    path.dirname(input.database) !== path.dirname(input.rollout)
  ) {
    throw fail("protocol_violation");
  }
  const directory = path.dirname(input.database);
  assertOwnedTempDirectory(directory);
  return directory;
}

/** Post-response integrity check for the private copied task; never reads a real Codex source. */
export async function verifyCopiedTask(input, { signal } = {}) {
  let database;
  let problem;
  const until = Date.now() + CODEX_LIMITS.helperMs;
  function checkWork() {
    if (signal?.aborted || Date.now() >= until) throw fail("protocol_violation");
  }
  try {
    const directory = checkVerifyInput(input);
    if (typeof process.geteuid !== "function") throw fail("protocol_violation");
    const ownerUid = BigInt(process.geteuid());
    checkWork();
    const databaseBefore = await regularOwned(input.database, ownerUid, CODEX_LIMITS.databaseBytes);
    const rolloutBefore = await regularOwned(input.rollout, ownerUid, CODEX_LIMITS.rolloutBytes);
    if (
      databaseBefore.nlink !== 1n ||
      rolloutBefore.nlink !== 1n ||
      (databaseBefore.mode & 0o7777n) !== 0o600n ||
      (rolloutBefore.mode & 0o7777n) !== 0o600n
    ) {
      throw fail("protocol_violation");
    }
    database = new Database(input.database, { readonly: true, fileMustExist: true, timeout: 1000 });
    database.pragma("query_only = ON");
    if (!database.readonly || database.pragma("query_only", { simple: true }) !== 1) {
      throw fail("protocol_violation");
    }
    checkWork();
    const rows = database
      .prepare("SELECT id, rollout_path FROM threads WHERE id = ? LIMIT 2")
      .all(input.taskId);
    checkWork();
    if (
      rows.length !== 1 ||
      rows[0]?.id !== input.taskId ||
      rows[0]?.rollout_path !== input.rollout
    ) {
      throw fail("protocol_violation");
    }
    database.close();
    database = undefined;
    checkWork();
    assertOwnedTempDirectory(directory);
    const databaseAfter = await regularOwned(input.database, ownerUid, CODEX_LIMITS.databaseBytes);
    const rolloutAfter = await regularOwned(input.rollout, ownerUid, CODEX_LIMITS.rolloutBytes);
    if (
      !sameStableFile(databaseBefore, databaseAfter) ||
      !sameStableFile(rolloutBefore, rolloutAfter) ||
      databaseAfter.nlink !== 1n ||
      rolloutAfter.nlink !== 1n ||
      (databaseAfter.mode & 0o7777n) !== 0o600n ||
      (rolloutAfter.mode & 0o7777n) !== 0o600n
    ) {
      throw fail("protocol_violation");
    }
  } catch {
    problem = "protocol_violation";
  } finally {
    try {
      database?.close();
    } catch {
      problem = "protocol_violation";
    }
  }
  return problem ? { ok: false, code: problem } : { ok: true };
}

/** One private internal operation; never returns persistence fields or exception details. */
export async function createSnapshot(input, { signal, onPhase } = {}) {
  let source;
  let copy;
  let problem;
  let ownedDirectory;
  const created = [];
  const until = Date.now() + CODEX_LIMITS.helperMs;
  function checkWork() {
    if (signal?.aborted || Date.now() >= until) throw fail("source_busy");
  }
  async function phase(name) {
    if (onPhase === undefined) return;
    if (process.env.NODE_ENV !== "test" || typeof onPhase !== "function")
      throw fail("source_unavailable");
    await onPhase(name);
  }
  async function createFile(filename) {
    const handle = await open(
      filename,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      created.push({ filename, stat: await handle.stat({ bigint: true }) });
      await handle.chmod(0o600);
    } finally {
      await handle.close();
    }
  }
  try {
    const { directory, reading } = checkInput(input);
    ownedDirectory = directory;
    if (typeof process.geteuid !== "function") throw fail("source_unavailable");
    const ownerUid = BigInt(process.geteuid());
    checkWork();
    const before = await preflight(input.sourceDatabase, ownerUid, checkWork);
    source = new Database(input.sourceDatabase, {
      readonly: true,
      fileMustExist: true,
      timeout: 1000,
    });
    source.pragma("query_only = ON");
    if (!source.readonly || source.pragma("query_only", { simple: true }) !== 1)
      throw fail("source_busy");
    await postflight(input.sourceDatabase, ownerUid, before, checkWork, { content: false });
    assertOwnedTempDirectory(directory);
    await createFile(input.destinationDatabase);
    const pageSize = source.pragma("page_size", { simple: true });
    const sourcePages = source.pragma("page_count", { simple: true });
    const backup = await source.backup(input.destinationDatabase, {
      progress({ totalPages }) {
        checkWork();
        if (totalPages * pageSize > CODEX_LIMITS.databaseBytes) throw fail("source_too_large");
      },
    });
    // The pinned library reports initial SQLITE_BUSY as zero-page progress.
    if (sourcePages > 0 && backup.totalPages === 0) throw fail("source_busy");
    source.close();
    source = undefined;
    await phase("before-source-postflight");
    await postflight(input.sourceDatabase, ownerUid, before, checkWork);
    checkWork();
    const saved = await regularOwned(
      input.destinationDatabase,
      ownerUid,
      CODEX_LIMITS.databaseBytes,
    );
    if (!sameIdentity(created[0].stat, saved) || (saved.mode & 0o7777n) !== 0o600n)
      throw fail("source_unavailable");
    copy = new Database(input.destinationDatabase, { fileMustExist: true, timeout: 1000 });
    const table = copy.prepare("SELECT type FROM sqlite_schema WHERE name = 'threads'").get();
    const columns = copy.pragma("table_info(threads)");
    if (
      table?.type !== "table" ||
      !["id", "rollout_path"].every((name) =>
        columns.some((column) => column.name === name && column.type.toUpperCase() === "TEXT"),
      )
    )
      throw fail("source_malformed");
    for (const row of copy.prepare("SELECT id, rollout_path FROM threads").iterate()) {
      checkWork();
      if (
        typeof row.id !== "string" ||
        !UUID.test(row.id) ||
        (row.rollout_path !== null && typeof row.rollout_path !== "string")
      )
        throw fail("source_malformed");
    }
    let selected;
    if (reading) {
      const rows = copy
        .prepare("SELECT id, rollout_path FROM threads WHERE id = ? LIMIT 2")
        .all(input.selectedTaskId);
      if (rows.length > 1) throw fail("source_malformed");
      if (rows.length !== 1 || typeof rows[0].rollout_path !== "string")
        throw fail("missing_source");
      selected = rows[0];
      await copyStableRollout({
        source: selected.rollout_path,
        destination: input.destinationRollout,
        allowedRoots: input.allowedRolloutRoots,
        signal,
        deadline: until,
      });
      created.push({
        filename: input.destinationRollout,
        stat: await lstat(input.destinationRollout, { bigint: true }),
      });
    }
    checkWork();
    assertOwnedTempDirectory(directory);
    await createFile(input.placeholder);
    const placeholder = await regularOwned(input.placeholder, ownerUid, 0);
    if ((placeholder.mode & 0o7777n) !== 0o600n) throw fail("source_unavailable");
    copy.transaction(() => {
      const count = copy
        .prepare("SELECT COUNT(*) AS count FROM threads WHERE rollout_path IS NOT NULL")
        .get().count;
      const changed = copy
        .prepare("UPDATE threads SET rollout_path = ? WHERE rollout_path IS NOT NULL")
        .run(input.placeholder).changes;
      if (changed !== count) throw fail("source_malformed");
      if (
        selected &&
        copy
          .prepare("UPDATE threads SET rollout_path = ? WHERE id = ?")
          .run(input.destinationRollout, input.selectedTaskId).changes !== 1
      )
        throw fail("source_malformed");
      const leaked = copy
        .prepare(
          "SELECT COUNT(*) AS count FROM threads WHERE rollout_path IS NOT NULL AND rollout_path != ? AND rollout_path != ?",
        )
        .get(input.placeholder, selected ? input.destinationRollout : input.placeholder).count;
      if (leaked !== 0) throw fail("source_malformed");
    })();
    copy.close();
    copy = undefined;
    checkWork();
    assertOwnedTempDirectory(directory);
    for (const { filename, stat } of created) {
      const maximum =
        filename === input.placeholder
          ? 0
          : filename === input.destinationRollout
            ? CODEX_LIMITS.rolloutBytes
            : CODEX_LIMITS.databaseBytes;
      const current = await regularOwned(filename, ownerUid, maximum);
      if (!sameIdentity(stat, current) || (current.mode & 0o7777n) !== 0o600n)
        throw fail("source_unavailable");
    }
  } catch (error) {
    problem = safeCode(error);
  } finally {
    for (const database of [source, copy]) {
      try {
        database?.close();
      } catch {
        problem ??= "source_unavailable";
      }
    }
    if (problem)
      for (const { filename, stat } of created.reverse()) {
        try {
          assertOwnedTempDirectory(ownedDirectory);
          if (sameIdentity(stat, await lstat(filename, { bigint: true }))) await unlink(filename);
        } catch (error) {
          if (error?.code !== "ENOENT") problem = "source_unavailable";
        }
      }
  }
  return problem ? { ok: false, code: problem } : { ok: true };
}

function runWorkerOperation(input, options) {
  return input?.operation === "verify-copied-task"
    ? verifyCopiedTask(input, options)
    : createSnapshot(input, options);
}

async function runCli() {
  process.umask(0o077);
  const abort = new AbortController();
  let buffer = Buffer.alloc(0);
  let total = 0;
  let started = false;
  let finished = false;
  function finish(result) {
    if (finished) return;
    finished = true;
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.stdin.destroy();
  }
  process.stdout.on("error", () => {
    abort.abort();
    process.stdin.destroy();
    process.exitCode = 1;
  });
  process.stdin.on("data", (bytes) => {
    total += bytes.length;
    if (total > CODEX_LIMITS.helperBytes) {
      abort.abort();
      if (!started) finish({ ok: false, code: "source_malformed" });
      return;
    }
    if (started) {
      if (bytes.toString("utf8").trim()) abort.abort();
      return;
    }
    buffer = Buffer.concat([buffer, bytes]);
    const newline = buffer.indexOf(10);
    if (newline < 0) return;
    started = true;
    try {
      if (
        buffer
          .subarray(newline + 1)
          .toString("utf8")
          .trim()
      )
        throw fail("source_malformed");
      const input = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, newline)),
      );
      void runWorkerOperation(input, { signal: abort.signal }).then(finish);
    } catch {
      finish({ ok: false, code: "source_malformed" });
    }
  });
  process.stdin.on("end", () => {
    abort.abort();
    if (!started) finish({ ok: false, code: "source_malformed" });
  });
  process.stdin.on("error", () => {
    abort.abort();
    if (!started) finish({ ok: false, code: "source_unavailable" });
  });
}

let entry = false;
try {
  entry =
    Boolean(process.argv[1]) &&
    (await realpath(process.argv[1])) === fileURLToPath(import.meta.url);
} catch {
  /* An imported worker has no CLI side effects. */
}
if (entry) await runCli();
