import "server-only";

import { constants } from "node:fs";
import { lstat, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { CODEX_LIMITS } from "./limits.mjs";

const MAX_ROLLOUT_BYTES = CODEX_LIMITS.rolloutBytes;
const CHUNK_BYTES = 64 * 1024;
const SAFE_CODES = new Set([
  "missing_source",
  "source_busy",
  "source_malformed",
  "source_too_large",
  "source_unavailable",
]);

function failure(code) {
  return Object.freeze({ code });
}

function safeFailure(error) {
  if (SAFE_CODES.has(error?.code)) return failure(error.code);
  return failure(error?.code === "ENOENT" ? "missing_source" : "source_unavailable");
}

function contained(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameSnapshot(left, right) {
  return sameIdentity(left, right) && left.size === right.size && left.mtimeNs === right.mtimeNs;
}

function regularOwned(stat, uid) {
  return stat.isFile() && !stat.isSymbolicLink() && stat.uid === uid;
}

function checkWork(signal, deadline) {
  if (signal?.aborted || Date.now() >= deadline) throw failure("source_busy");
}

async function inspectSource(source, roots, uid) {
  const anchor =
    roots.find((root) => contained(root.input, source)) ??
    roots.find((root) => contained(root.canonical, source));
  if (!anchor) throw failure("source_unavailable");
  const base = contained(anchor.input, source) ? anchor.input : anchor.canonical;
  const expected = path.join(anchor.canonical, path.relative(base, source));
  const listed = await lstat(source, { bigint: true });
  if (!regularOwned(listed, uid)) throw failure("source_unavailable");
  if (listed.size > BigInt(MAX_ROLLOUT_BYTES)) throw failure("source_too_large");
  // A differing canonical path also rejects symlinks in directories below a root.
  if ((await realpath(source)) !== expected) throw failure("source_unavailable");
  return { canonical: expected, listed };
}

async function changedSource(source, canonical, before, handle, uid) {
  const after = await handle.stat({ bigint: true });
  if (!regularOwned(after, uid)) throw failure("source_unavailable");
  if (after.size < before.size) throw failure("source_busy");
  let named;
  try {
    named = await lstat(source, { bigint: true });
    if (named.isSymbolicLink()) return true;
    if (!regularOwned(named, uid)) throw failure("source_unavailable");
    if (sameIdentity(before, named) && named.size < before.size) throw failure("source_busy");
    if ((await realpath(source)) !== canonical) return true;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
  return !sameSnapshot(before, after) || !sameSnapshot(before, named);
}

/**
 * Copy one approved rollout into a caller-owned private temp directory.
 * deadline is an optional epoch-millisecond cooperative deadline, not the
 * parent's hard worker deadline. onChunk is reserved for synthetic test injection.
 */
export async function copyStableRollout(options) {
  let input;
  let output;
  let outputIdentity;
  let outputPath;
  let result;
  let problem;
  let signal;
  let until = Infinity;
  try {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw failure("source_malformed");
    }
    let { source, destination } = options;
    const { allowedRoots, deadline, onChunk } = options;
    signal = options.signal;
    const validPath = (value) =>
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= 4096 &&
      !/[\u0000-\u001f\u007f]/u.test(value) &&
      path.isAbsolute(value);
    if (
      !validPath(source) ||
      !validPath(destination) ||
      path.extname(source) !== ".jsonl" ||
      path.extname(destination) !== ".jsonl" ||
      !Array.isArray(allowedRoots) ||
      allowedRoots.length < 1 ||
      allowedRoots.length > 2 ||
      allowedRoots.some((root) => !validPath(root)) ||
      (deadline !== undefined && !Number.isFinite(deadline)) ||
      (signal !== undefined && typeof signal?.aborted !== "boolean") ||
      (onChunk !== undefined && typeof onChunk !== "function")
    ) {
      throw failure("source_malformed");
    }
    if (typeof process.geteuid !== "function") throw failure("source_unavailable");
    const uid = BigInt(process.geteuid());
    until = deadline ?? Infinity;
    checkWork(signal, until);
    source = path.resolve(source);
    destination = path.resolve(destination);
    const roots = [];
    for (const root of allowedRoots) {
      const inputRoot = path.resolve(root);
      const stat = await lstat(inputRoot, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid) {
        throw failure("source_unavailable");
      }
      roots.push({ input: inputRoot, canonical: await realpath(inputRoot) });
    }
    const parentPath = path.dirname(destination);
    const parent = await lstat(parentPath, { bigint: true });
    if (
      !parent.isDirectory() ||
      parent.isSymbolicLink() ||
      parent.uid !== uid ||
      (parent.mode & 0o077n) !== 0n
    )
      throw failure("source_unavailable");
    const canonicalParent = await realpath(parentPath);
    outputPath = path.join(canonicalParent, path.basename(destination));
    if (roots.some((root) => contained(root.canonical, outputPath))) {
      throw failure("source_unavailable");
    }
    checkWork(signal, until);
    output = await open(
      outputPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    outputIdentity = await output.stat({ bigint: true });
    await output.chmod(0o600);
    const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      checkWork(signal, until);
      await output.truncate(0);
      let inspected;
      try {
        inspected = await inspectSource(source, roots, uid);
      } catch (error) {
        if (attempt > 1 && error?.code === "ENOENT") throw failure("source_busy");
        throw error;
      }
      input = await open(inspected.canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const before = await input.stat({ bigint: true });
        if (!regularOwned(before, uid)) throw failure("source_unavailable");
        if (sameIdentity(inspected.listed, before) && before.size < inspected.listed.size) {
          throw failure("source_busy");
        }
        let changed = !sameSnapshot(inspected.listed, before);
        let copied = 0;
        if (!changed) {
          while (copied < Number(before.size)) {
            checkWork(signal, until);
            const requested = Math.min(CHUNK_BYTES, Number(before.size) - copied);
            const { bytesRead } = await input.read(buffer, 0, requested, copied);
            if (bytesRead !== requested) throw failure("source_busy");
            let written = 0;
            while (written < bytesRead) {
              checkWork(signal, until);
              const { bytesWritten } = await output.write(
                buffer,
                written,
                bytesRead - written,
                copied + written,
              );
              if (
                !Number.isInteger(bytesWritten) ||
                bytesWritten < 1 ||
                bytesWritten > bytesRead - written
              ) {
                throw failure("source_busy");
              }
              written += bytesWritten;
            }
            copied += bytesRead;
            await onChunk?.({ attempt, bytesCopied: copied });
            checkWork(signal, until);
          }
          changed = await changedSource(source, inspected.canonical, before, input, uid);
        }
        if (!changed) {
          result = { bytesCopied: copied, attempts: attempt };
          break;
        }
        if (attempt === 2) throw failure("source_busy");
      } finally {
        await input.close();
        input = undefined;
      }
    }
    checkWork(signal, until);
    const saved = await output.stat({ bigint: true });
    const named = await lstat(outputPath, { bigint: true });
    const currentParent = await lstat(parentPath, { bigint: true });
    if (
      !result ||
      !regularOwned(named, uid) ||
      !sameIdentity(saved, named) ||
      !sameIdentity(outputIdentity, saved) ||
      saved.size !== BigInt(result.bytesCopied) ||
      named.size !== saved.size ||
      (named.mode & 0o777n) !== 0o600n ||
      !sameIdentity(parent, currentParent) ||
      !currentParent.isDirectory() ||
      currentParent.isSymbolicLink() ||
      currentParent.uid !== uid ||
      (currentParent.mode & 0o077n) !== 0n ||
      (await realpath(parentPath)) !== canonicalParent
    )
      throw failure("source_busy");
  } catch (error) {
    problem = safeFailure(error);
  } finally {
    for (const handle of [input, output]) {
      try {
        await handle?.close();
      } catch {
        problem ??= failure("source_unavailable");
      }
    }
    if (!problem) {
      try {
        checkWork(signal, until);
      } catch (error) {
        problem = safeFailure(error);
      }
    }
    if (problem && outputIdentity) {
      try {
        const named = await lstat(outputPath, { bigint: true });
        if (sameIdentity(named, outputIdentity)) await unlink(outputPath);
      } catch (error) {
        if (error?.code !== "ENOENT") problem = failure("source_unavailable");
      }
    }
  }
  if (problem) throw problem;
  return result;
}
