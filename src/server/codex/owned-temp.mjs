import "server-only";

import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  opendirSync,
  readSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const MARKER_NAME = ".cockpit-owner.json";
const OWNER = "cockpit-codex";
const MAX_MARKER_BYTES = 16_384;
const MAX_PROCESSES = 8;
const STALE_AFTER_MS = 60 * 60 * 1_000;
const operationName = /^operation-[A-Za-z0-9]{6}$/;
const tokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function invalidOwnership() {
  return new Error("Invalid Cockpit temporary ownership");
}

function uid() {
  if (typeof process.geteuid !== "function") throw invalidOwnership();
  return process.geteuid();
}

function sameObject(first, second) {
  return first.dev === second.dev && first.ino === second.ino;
}

function privateDirectory(directory, ownerUid) {
  const stat = lstatSync(directory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== ownerUid ||
    (stat.mode & 0o7777) !== 0o700 ||
    realpathSync(directory) !== directory
  ) {
    throw invalidOwnership();
  }
  return stat;
}

function tempParent(candidate, create) {
  const ownerUid = uid();
  // Fixed Unix host root: a sterile child's TMPDIR never changes containment.
  const tempRoot = realpathSync("/tmp");
  const directory = candidate ?? path.join(tempRoot, `${OWNER}-${ownerUid}`);
  if (
    typeof directory !== "string" ||
    !path.isAbsolute(directory) ||
    path.normalize(directory) !== directory
  ) {
    throw invalidOwnership();
  }
  const relative = path.relative(tempRoot, directory);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    throw invalidOwnership();
  }
  // Canonicalize ancestors first, so even a missing parent cannot be created through a symlink.
  if (realpathSync(path.dirname(directory)) !== path.dirname(directory)) throw invalidOwnership();
  if (create) {
    try {
      mkdirSync(directory, { mode: 0o700 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  return { directory, stat: privateDirectory(directory, ownerUid), ownerUid };
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function safeString(value, limit) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= limit &&
    !/[\x00-\x1f\x7f]/.test(value)
  );
}

function validProcess(record) {
  return (
    exactKeys(record, ["pid", "pgid", "executableIdentity", "startToken"]) &&
    Number.isSafeInteger(record.pid) &&
    record.pid > 1 &&
    record.pid <= 2_147_483_647 &&
    record.pgid === record.pid &&
    safeString(record.executableIdentity, 256) &&
    /^\d+:\d+:\d+$/.test(record.executableIdentity) &&
    safeString(record.startToken, 256)
  );
}

function validMarker(marker, ownerUid) {
  return (
    exactKeys(marker, ["owner", "version", "uid", "token", "createdAt", "processes"]) &&
    marker.owner === OWNER &&
    marker.version === 1 &&
    marker.uid === ownerUid &&
    typeof marker.token === "string" &&
    tokenPattern.test(marker.token) &&
    Number.isSafeInteger(marker.createdAt) &&
    marker.createdAt > 0 &&
    Array.isArray(marker.processes) &&
    marker.processes.length <= MAX_PROCESSES &&
    marker.processes.every(validProcess) &&
    new Set(marker.processes.map((record) => record.pid)).size === marker.processes.length
  );
}

function readMarker(directory, ownerUid) {
  const markerPath = path.join(directory, MARKER_NAME);
  const stat = lstatSync(markerPath);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.uid !== ownerUid ||
    (stat.mode & 0o7777) !== 0o600 ||
    stat.nlink !== 1 ||
    stat.size > MAX_MARKER_BYTES
  )
    throw invalidOwnership();
  const descriptor = openSync(markerPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const pinned = fstatSync(descriptor);
    if (!sameObject(stat, pinned)) throw invalidOwnership();
    const buffer = Buffer.alloc(MAX_MARKER_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > MAX_MARKER_BYTES) throw invalidOwnership();
    const bytes = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length));
    const marker = JSON.parse(bytes);
    if (!validMarker(marker, ownerUid)) throw invalidOwnership();
    return { marker, bytes, stat: pinned };
  } finally {
    closeSync(descriptor);
  }
}

// A reused PID, EPERM, or an unsupported check remains live/ambiguous. No signal is sent.
function defaultIsLive(record) {
  let ambiguous = false;
  for (const pid of [record.pid, -record.pgid]) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if (error.code !== "ESRCH") ambiguous = true;
    }
  }
  return ambiguous ? undefined : false;
}

function allGone(records, isLive) {
  return records.every((record) => {
    try {
      return isLive(record) === false;
    } catch {
      return false;
    }
  });
}

function validateOperation(parent, directory) {
  if (
    !sameObject(parent.stat, privateDirectory(parent.directory, parent.ownerUid)) ||
    path.dirname(directory) !== parent.directory ||
    !operationName.test(path.basename(directory))
  ) {
    throw invalidOwnership();
  }
  const directoryStat = privateDirectory(directory, parent.ownerUid);
  const marker = readMarker(directory, parent.ownerUid);
  return { directoryStat, markerStat: marker.stat, marker: marker.marker, bytes: marker.bytes };
}

/** Internal worker check; exposes no marker data and creates nothing. */
export function assertOwnedTempDirectory(directory) {
  try {
    if (typeof directory !== "string" || path.normalize(directory) !== directory)
      throw invalidOwnership();
    validateOperation(tempParent(path.dirname(directory), false), directory);
  } catch {
    throw invalidOwnership();
  }
}

/** Creates one private operation directory. It does not spawn or kill processes. */
export function createOwnedTemp({ parent: candidate } = {}) {
  let allocation;
  try {
    const parent = tempParent(candidate, true);
    const directory = realpathSync(mkdtempSync(path.join(parent.directory, "operation-")));
    chmodSync(directory, 0o700);
    const directoryStat = privateDirectory(directory, parent.ownerUid);
    allocation = { parent, directory, directoryStat };
    const markerPath = path.join(directory, MARKER_NAME);
    const marker = {
      owner: OWNER,
      version: 1,
      uid: parent.ownerUid,
      token: randomUUID(),
      createdAt: Date.now(),
      processes: [],
    };
    let expectedBytes = JSON.stringify(marker);
    writeFileSync(markerPath, expectedBytes, { flag: "wx", mode: 0o600 });
    chmodSync(markerPath, 0o600);
    let removed = false;

    function current() {
      const result = validateOperation(parent, directory);
      if (!sameObject(result.directoryStat, directoryStat) || result.bytes !== expectedBytes)
        throw invalidOwnership();
      return result;
    }

    function recordProcess(record) {
      try {
        if (
          removed ||
          !validProcess(record) ||
          record.pid === process.pid ||
          marker.processes.length >= MAX_PROCESSES ||
          marker.processes.some((entry) => entry.pid === record.pid)
        )
          throw invalidOwnership();
        const before = current();
        const descriptor = openSync(markerPath, constants.O_WRONLY | constants.O_NOFOLLOW);
        try {
          // Pin the marker descriptor, rather than following a replacement pathname.
          if (
            !sameObject(before.markerStat, fstatSync(descriptor)) ||
            current().bytes !== before.bytes
          ) {
            throw invalidOwnership();
          }
          marker.processes.push({ ...record });
          expectedBytes = JSON.stringify(marker);
          writeFileSync(descriptor, expectedBytes);
        } finally {
          closeSync(descriptor);
        }
      } catch {
        throw invalidOwnership();
      }
    }

    function cleanup() {
      if (removed) return true;
      try {
        const before = current();
        if (!allGone(before.marker.processes, defaultIsLive)) return false;
        const after = current();
        if (!sameObject(before.directoryStat, after.directoryStat) || before.bytes !== after.bytes)
          return false;
        // rm removes interior symlinks themselves, never their targets.
        rmSync(directory, { recursive: true, force: false });
        removed = true;
        return true;
      } catch {
        return false;
      }
    }

    return { directory, markerPath, recordProcess, cleanup };
  } catch {
    // No process or source copy exists before this function returns. If marker
    // creation fails, remove only the still-pinned directory we just allocated.
    if (allocation) {
      try {
        const { parent, directory, directoryStat } = allocation;
        if (
          sameObject(parent.stat, privateDirectory(parent.directory, parent.ownerUid)) &&
          sameObject(directoryStat, privateDirectory(directory, parent.ownerUid))
        ) {
          rmSync(directory, { recursive: true, force: false });
        }
      } catch {
        /* A replaced or inaccessible allocation must be preserved. */
      }
    }
    throw invalidOwnership();
  }
}

/** Bounded startup cleanup; isLive is a test-only injection, never a browser input. */
export function reapOwnedTemps({
  parent: candidate,
  now = Date.now(),
  maxEntries = 32,
  isLive = defaultIsLive,
} = {}) {
  if (
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(maxEntries) ||
    maxEntries < 0 ||
    maxEntries > 32 ||
    typeof isLive !== "function" ||
    (isLive !== defaultIsLive && process.env.NODE_ENV !== "test")
  ) {
    throw invalidOwnership();
  }
  let parent;
  try {
    parent = tempParent(candidate, false);
  } catch {
    return { examined: 0, removed: 0 };
  }
  const result = { examined: 0, removed: 0 };
  const entries = opendirSync(parent.directory, { bufferSize: 1 });
  try {
    while (result.examined < maxEntries) {
      const entry = entries.readSync();
      if (!entry) break;
      result.examined += 1;
      if (!entry.isDirectory() || entry.isSymbolicLink() || !operationName.test(entry.name))
        continue;
      const directory = path.join(parent.directory, entry.name);
      try {
        const before = validateOperation(parent, directory);
        if (
          Math.max(before.directoryStat.mtimeMs, before.marker.createdAt) >= now - STALE_AFTER_MS ||
          !allGone(before.marker.processes, isLive)
        )
          continue;
        const after = validateOperation(parent, directory);
        if (!sameObject(before.directoryStat, after.directoryStat) || before.bytes !== after.bytes)
          continue;
        rmSync(directory, { recursive: true, force: false });
        result.removed += 1;
      } catch {
        /* Malformed, replaced, or inaccessible entries are left untouched. */
      }
    }
  } finally {
    entries.closeSync();
  }
  return result;
}
