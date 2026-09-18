import "server-only";

import { stat, realpath } from "node:fs/promises";
import path from "node:path";
import { CODEX_LIMITS } from "./limits.mjs";
import { runOwnedProcess } from "./owned-process.mjs";
import { assertOwnedTempDirectory } from "./owned-temp.mjs";

// Next turns `new URL(..., import.meta.url)` into a public `/_next/` asset URL,
// which is not a filesystem path that Node can execute. The worker and its
// local imports are traced explicitly in next.config.ts for this fixed path.
const workerPath = path.join(process.cwd(), "src/server/codex/snapshot-worker.mjs");
const fail = (code) => Object.assign(new Error(code), { code });
const SAFE_WORKER_CODES = new Set([
  "missing_source",
  "protocol_violation",
  "source_busy",
  "source_malformed",
  "source_too_large",
  "source_unavailable",
]);

async function runSnapshotWorker({ input, owner, signal, sampleGroup }) {
  assertOwnedTempDirectory(owner.directory);
  let worker;
  try {
    worker = await realpath(workerPath);
    if (!(await stat(worker)).isFile()) throw fail("source_unavailable");
  } catch {
    throw fail("source_unavailable");
  }
  if (Buffer.byteLength(JSON.stringify(input)) + 1 > CODEX_LIMITS.helperBytes)
    throw fail("source_unavailable");
  let pending = Buffer.alloc(0);
  let received = false;
  await runOwnedProcess({
    command: process.execPath,
    args: ["--conditions=react-server", worker],
    home: owner.directory,
    app: false,
    owner,
    signal,
    sampleGroup,
    lifetimeMs: CODEX_LIMITS.helperMs,
    stdoutCap: CODEX_LIMITS.helperBytes,
    onStart(api) {
      api.send(input);
    },
    onData(bytes, api) {
      pending = Buffer.concat([pending, bytes]);
      const newline = pending.indexOf(10);
      if (newline === -1) return;
      if (received || newline !== pending.length - 1) throw fail("protocol_violation");
      const result = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(pending.subarray(0, newline)),
      );
      received = true;
      pending = Buffer.alloc(0);
      if (
        result !== null &&
        typeof result === "object" &&
        result.ok === false &&
        Object.keys(result).length === 2 &&
        SAFE_WORKER_CODES.has(result.code)
      ) {
        api.stop(result.code);
        return;
      }
      if (
        result === null ||
        typeof result !== "object" ||
        result.ok !== true ||
        Object.keys(result).length !== 1
      ) {
        throw fail("protocol_violation");
      }
      api.complete(true);
    },
    onEnd() {
      if (pending.length || !received) throw fail("protocol_violation");
    },
  });
}

// Private parent/worker channel: none of these paths is a browser contract.
export async function createStateSnapshot({
  sourceDatabase,
  selectedTaskId,
  allowedRolloutRoots,
  owner,
  signal,
  sampleGroup,
}) {
  const database = path.join(owner.directory, "state_5.sqlite");
  const placeholder = path.join(owner.directory, "list-placeholder.jsonl");
  const rollout = path.join(owner.directory, "selected.jsonl");
  const input = {
    sourceDatabase,
    destinationDatabase: database,
    placeholder,
    ...(selectedTaskId !== undefined
      ? { selectedTaskId, allowedRolloutRoots, destinationRollout: rollout }
      : {}),
  };
  await runSnapshotWorker({ input, owner, signal, sampleGroup });
  return {
    database,
    placeholder,
    rollout: selectedTaskId === undefined ? null : rollout,
    copiedRowExists: selectedTaskId !== undefined,
  };
}

/** Bounded worker recheck after the App Server has consumed the private copy. */
export async function verifyCopiedTask({ database, rollout, taskId, owner, signal, sampleGroup }) {
  await runSnapshotWorker({
    input: { operation: "verify-copied-task", database, rollout, taskId },
    owner,
    signal,
    sampleGroup,
  });
}
