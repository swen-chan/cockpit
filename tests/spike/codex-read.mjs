// Explicit, manual Unix acceptance. Never discovers or opens an existing Codex home.
// node --conditions=react-server tests/spike/codex-read.mjs --executable /absolute/codex
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { createOwnedTemp } from "../../src/server/codex/owned-temp.mjs";
import { exchangeAppServer, probeVersion } from "../../src/server/codex/protocol.mjs";
import { runOwnedProcess, sampleOwnedGroup } from "../../src/server/codex/owned-process.mjs";
import { createStateSnapshot } from "../../src/server/codex/state-snapshot.mjs";

const verdicts = [];
const owners = [];
let writer;
let stage = "arguments";
let samples = 0;
let peakRssKiB = 0;
const measure = async (pgid) => {
  const sample = await sampleOwnedGroup(pgid);
  samples++;
  peakRssKiB = Math.max(peakRssKiB, sample.rssKiB);
  return sample;
};
async function home() {
  const owner = createOwnedTemp();
  owners.push(owner);
  await fs.mkdir(path.join(owner.directory, "tmp"), { mode: 0o700 });
  return owner;
}
async function fingerprints(root) {
  const result = {};
  async function visit(directory) {
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, item.name);
      if (item.isDirectory()) {
        await visit(filename);
        continue;
      }
      const info = await fs.lstat(filename, { bigint: true });
      assert(info.isFile() && !info.isSymbolicLink() && info.uid === BigInt(process.geteuid()));
      if (filename === path.join(root, "state_5.sqlite-shm")) {
        assert(info.size <= 64n * 1024n * 1024n);
        continue;
      }
      result[path.relative(root, filename)] = [
        String(info.dev),
        String(info.ino),
        String(info.size),
        String(info.mtimeNs),
        createHash("sha256")
          .update(await fs.readFile(filename))
          .digest("hex"),
      ];
    }
  }
  await visit(root);
  return result;
}
async function expectCode(operation, code) {
  let failure;
  try {
    await operation();
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.code, code);
}
try {
  assert.deepEqual(process.argv.slice(2, 3), ["--executable"]);
  assert.equal(process.argv.length, 4);
  const command = await fs.realpath(process.argv[3]);
  assert(path.isAbsolute(command));
  assert.equal(process.platform, "darwin", "This OS-deny acceptance runner is macOS-specific.");
  const source = await home();
  const sourceDatabase = path.join(source.directory, "state_5.sqlite");
  const profile = `(version 1) (allow default) (deny network-outbound) (deny file-read* (subpath ${JSON.stringify(source.directory)}))`;
  const underDeny = (owner) => ({
    command: "/usr/bin/sandbox-exec",
    argvPrefix: ["-p", profile, command],
    home: owner.directory,
    owner,
    sampleGroup: measure,
  });
  stage = "denied_version_probe";
  const probe = await home();
  await probeVersion(underDeny(probe));
  assert(probe.cleanup());
  verdicts.push({ test: "exact_version_under_outbound_and_source_read_deny", verdict: "PASS" });
  stage = "initialize_synthetic_database";
  // Empty HOME, not a source snapshot. The exact binary supplies migration metadata.
  await exchangeAppServer({
    command,
    home: source.directory,
    owner: source,
    kind: "list",
    sampleGroup: measure,
  });
  stage = "seed_active_wal";
  writer = new Database(sourceDatabase, { fileMustExist: true });
  writer.pragma("journal_mode = WAL");
  writer.pragma("wal_autocheckpoint = 0");
  const columns = new Set(
    writer
      .prepare("PRAGMA table_info(threads)")
      .all()
      .map((row) => row.name),
  );
  const sessions = path.join(source.directory, "sessions");
  await fs.mkdir(sessions, { mode: 0o700, recursive: true });
  const ids = Array.from(
    { length: 6 },
    (_, i) => `11111111-1111-4111-8111-${String(i + 1).padStart(12, "0")}`,
  );
  const stamp = "2026-02-02T02:40:00.000Z";
  for (let i = 0; i < ids.length; i++) {
    const title = `Synthetic task ${i + 1}`;
    const rollout = path.join(sessions, `${i + 1}.jsonl`);
    const records = [
      {
        timestamp: stamp,
        type: "session_meta",
        payload: {
          id: ids[i],
          session_id: ids[i],
          timestamp: stamp,
          cwd: "/synthetic/projects/cockpit",
          originator: "codex_cli_rs",
          cli_version: "0.145.0",
          source: "cli",
          model_provider: "openai",
          base_instructions: null,
          history_mode: "legacy",
        },
      },
      {
        timestamp: stamp,
        type: "event_msg",
        payload: { type: "task_started", turn_id: "synthetic-turn", model_context_window: null },
      },
      {
        timestamp: stamp,
        type: "event_msg",
        payload: { type: "user_message", message: title, text_elements: [], local_images: [] },
      },
      {
        timestamp: stamp,
        type: "event_msg",
        payload: {
          type: "agent_message",
          message: "Synthetic completed answer",
          phase: "final_answer",
        },
      },
      {
        timestamp: stamp,
        type: "event_msg",
        payload: {
          type: "task_complete",
          turn_id: "synthetic-turn",
          last_agent_message: "Synthetic completed answer",
        },
      },
    ];
    await fs.writeFile(rollout, records.map((record) => JSON.stringify(record)).join("\n") + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    const time = 1770000000 + i;
    const row = {
      id: ids[i],
      rollout_path: rollout,
      created_at: time,
      updated_at: time,
      recency_at: time,
      created_at_ms: time * 1000,
      updated_at_ms: time * 1000,
      recency_at_ms: time * 1000,
      source: "cli",
      history_mode: "legacy",
      model_provider: "openai",
      cwd: "/synthetic/projects/cockpit",
      cli_version: "0.145.0",
      title,
      preview: title,
      first_user_message: title,
      sandbox_policy: "read-only",
      approval_mode: "never",
      tokens_used: 0,
      has_user_event: 1,
      archived: 0,
    };
    const names = Object.keys(row).filter((name) => columns.has(name));
    writer
      .prepare(
        `INSERT INTO threads (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`,
      )
      .run(...names.map((name) => row[name]));
  }
  assert((await fs.stat(`${sourceDatabase}-wal`)).size > 0);
  const before = await fingerprints(source.directory);
  stage = "os_policy_negative_controls";
  const controls = await home();
  const controlFile = fileURLToPath(new URL("../helpers/codex-os-control.mjs", import.meta.url));
  let controlOutput = "";
  const control = await runOwnedProcess({
    command: "/usr/bin/sandbox-exec",
    args: ["-p", profile, process.execPath, controlFile, sourceDatabase],
    home: controls.directory,
    owner: controls,
    sampleGroup: measure,
    lifetimeMs: 2000,
    stdoutCap: 4096,
    onStart() {},
    onData(bytes, api) {
      controlOutput += bytes;
      if (controlOutput.endsWith("\n")) api.complete(JSON.parse(controlOutput));
    },
  });
  assert.deepEqual(control.value, {
    parentNetworkDenied: true,
    descendantNetworkDenied: true,
    sourceReadDenied: true,
  });
  assert(controls.cleanup());
  verdicts.push({ test: "parent_descendant_outbound_and_source_read_controls", verdict: "PASS" });
  stage = "snapshot_and_state_only_list";
  const list = await home();
  await createStateSnapshot({ sourceDatabase, owner: list, sampleGroup: measure });
  const index = (await exchangeAppServer({ ...underDeny(list), kind: "list" })).result;
  assert.equal(index.data.length, 5);
  assert.deepEqual(
    index.data.map((row) => row.id),
    ids.slice(1).reverse(),
  );
  assert.equal(typeof index.nextCursor, "string");
  assert(list.cleanup());
  verdicts.push({ test: "active_wal_backup_scrubbed_five_item_list_under_deny", verdict: "PASS" });
  stage = "selected_snapshot_and_read";
  const detail = await home();
  const copy = await createStateSnapshot({
    sourceDatabase,
    selectedTaskId: ids[5],
    allowedRolloutRoots: [sessions],
    owner: detail,
    sampleGroup: measure,
  });
  const result = (
    await exchangeAppServer({
      ...underDeny(detail),
      kind: "read",
      taskId: ids[5],
      copiedRowExists: copy.copiedRowExists,
    })
  ).result;
  assert.equal(result.thread.id, ids[5]);
  assert.equal(result.thread.source, "cli");
  assert(
    result.thread.turns
      .flatMap((turn) => turn.items)
      .some((item) => item.type === "agentMessage" && item.text === "Synthetic completed answer"),
  );
  assert(!JSON.stringify(index).includes(source.directory));
  assert(!JSON.stringify(result).includes(source.directory));
  assert(detail.cleanup());
  verdicts.push({ test: "selected_legacy_id_source_bound_read_under_deny", verdict: "PASS" });
  stage = "source_fingerprints";
  assert.deepEqual(await fingerprints(source.directory), before);
  verdicts.push({
    test: "source_identity_bytes_mtime_unchanged_with_exact_shm_exception",
    verdict: "PASS",
  });
  stage = "real_group_rss_limit";
  const rss = await home();
  const fake = fileURLToPath(new URL("../helpers/codex-fake.mjs", import.meta.url));
  let rssSamples = 0;
  let rssPeak = 0;
  let overLimitMembers = 0;
  const measureRss = async (pgid) => {
    const sample = await sampleOwnedGroup(pgid);
    rssSamples++;
    rssPeak = Math.max(rssPeak, sample.rssKiB);
    if (sample.rssKiB > 384 * 1024) overLimitMembers = Math.max(overLimitMembers, sample.members);
    return sample;
  };
  await fs.writeFile(
    path.join(rss.directory, "fixture-mode.json"),
    JSON.stringify({ mode: "descendant-rss" }),
    { mode: 0o600 },
  );
  await expectCode(
    () =>
      exchangeAppServer({
        command: process.execPath,
        argvPrefix: [fake],
        home: rss.directory,
        owner: rss,
        kind: "list",
        sampleGroup: measureRss,
      }),
    "resource_limit",
  );
  assert(rssPeak > 384 * 1024);
  assert(rssSamples > 0);
  assert(overLimitMembers >= 2);
  assert(rss.cleanup());
  verdicts.push({
    test: "actual_parent_plus_descendant_rss_limit_reclaims_group",
    verdict: "PASS",
    samples: rssSamples,
    peakRssKiB: rssPeak,
    overLimitMembers,
  });
} catch (error) {
  const code = [
    "protocol_violation",
    "resource_limit",
    "timeout",
    "aborted",
    "source_unavailable",
  ].includes(error?.code)
    ? error.code
    : "synthetic_acceptance_failed";
  verdicts.push({ test: stage, verdict: "FAIL", code });
  process.exitCode = 1;
} finally {
  writer?.close();
  const cleaned = owners.map((owner) => owner.cleanup()).every(Boolean);
  if (!cleaned) process.exitCode = 1;
  console.log(
    JSON.stringify({
      tests: verdicts,
      ownedTempsRemoved: cleaned,
      realSourceAccess: false,
      otherOperationSamples: samples,
      otherOperationPeakRssKiB: samples ? peakRssKiB : null,
      networkEvidence: "outbound denied, attempts not observed, no production sandbox claim",
      remaining: ["unclean_parent_loss", "complete_snapshot_resource_and_failure_suite"],
      projectionEvidence:
        "explicit synthetic verdict/count fields only; product DTO deferred to Task 4",
      gate: "NOT_GO",
    }),
  );
}
