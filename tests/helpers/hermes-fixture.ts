import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

import type { PrivateSourceManifest } from "@/server/config/source-manifest";

export const hermesFixtureManifest: PrivateSourceManifest = {
  configRelativePath: "settings.yaml",
  conversation: {
    databaseRelativePath: "conversation-store.sqlite",
    sessionTable: "conversation_records",
    promptTable: "snapshot_records",
    sessionColumns: {
      id: "record_id",
      source: "origin_kind",
      title: "headline",
      startedAt: "created_time",
      endedAt: "finished_time",
      lastActivityAt: "last_seen",
      messageCount: "visible_count",
      toolCallCount: "tool_count",
      model: "model_name",
      profileName: "profile_name",
      workspace: "work_dir",
      hidden: "is_hidden",
      archived: "is_archived",
      promptHash: "snapshot_ref",
      embeddedPrompt: "legacy_body",
    },
    promptColumns: { hash: "fingerprint", prompt: "body" },
    messages: {
      table: "message_records",
      columns: {
        id: "message_id",
        sessionId: "conversation_ref",
        role: "speaker",
        content: "body",
        toolName: "tool_label",
        timestamp: "occurred_at",
        active: "is_active",
        compacted: "is_compacted",
        displayKind: "view_kind",
      },
    },
  },
  jobs: {
    definitionsRelativePath: "scheduler/jobs.json",
    executionsDatabaseRelativePath: "scheduler/executions.sqlite",
    rootJobsField: "task_items",
    definitionFields: {
      id: "task_key",
      name: "display_name",
      schedule: "cadence_spec",
      scheduleDisplay: "cadence_label",
      createdAt: "added_time",
      enabled: "is_enabled",
      state: "lifecycle_state",
      lastRunAt: "previous_time",
      nextRunAt: "upcoming_time",
      lastStatus: "result_state",
      failureStreak: "consecutive_failures",
      deliver: "delivery_target",
      profile: "profile_alias",
      skill: "single_capability",
      skills: "capability_list",
      enabledToolsets: "toolset_list",
    },
    scheduleFields: {
      display: "label_text",
      expression: "cron_expression",
      value: "raw_value",
      runAt: "scheduled_time",
    },
    executionTable: "attempt_records",
    executionColumns: {
      id: "attempt_key",
      jobId: "task_ref",
      status: "attempt_state",
      claimedAt: "claimed_time",
      startedAt: "begin_time",
      finishedAt: "end_time",
    },
  },
};

export const forbiddenHermesFixtureMarkers = [
  "CONFIG_CREDENTIAL_MARKER",
  "RAW_CONFIG_MARKER",
  "MEMORY_CREDENTIAL_MARKER",
  "USER_PASSWORD_MARKER",
  "SYSTEM_PROMPT_CREDENTIAL_MARKER",
  "RAW_PROMPT_METADATA_MARKER",
  "SKILL_CREDENTIAL_MARKER",
  "WORKSPACE_CREDENTIAL_MARKER",
  "CONVERSATION_CREDENTIAL_MARKER",
  "RAW_SESSION_ID_MARKER",
  "RAW_SESSION_ORIGIN_MARKER",
  "RAW_EMBEDDED_PROMPT_MARKER",
  "RAW_TOOL_BODY_MARKER",
  "RAW_REASONING_MARKER",
  "RAW_API_PAYLOAD_MARKER",
  "RAW_CALLS_MARKER",
  "RAW_JOBS_ROOT_MARKER",
  "RAW_JOB_PROMPT_MARKER",
  "RAW_JOB_SCRIPT_MARKER",
  "PRIVATE_RECIPIENT_MARKER",
  "RAW_EXECUTION_ERROR_MARKER",
  "RAW_PROCESS_MARKER",
  "RAW_EXECUTION_OUTPUT_MARKER",
] as const;

export const privateHermesFixturePersistenceMarkers = [
  "source-manifest.json",
  "settings.yaml",
  "conversation-store.sqlite",
  "conversation_records",
  "message_records",
  "snapshot_records",
  "scheduler/jobs.json",
  "scheduler/executions.sqlite",
  "attempt_records",
] as const;

export interface HermesFixture {
  databaseFiles: string[];
  environment: Record<string, string>;
  home: string;
  manifestPath: string;
  root: string;
  workspace: string;
}

export interface HermesFixtureSourceFingerprint {
  hash: string;
  label: string;
  mtimeNanoseconds: string;
  path: string;
  size: string;
}

export interface HermesFixtureSourceSnapshot {
  allowedEmptyWalFiles: string[];
  existingSharedMemoryFiles: string[];
  files: HermesFixtureSourceFingerprint[];
  sharedMemoryFiles: string[];
  root: string;
}

function writeConversationSources(home: string): string {
  const databasePath = path.join(home, hermesFixtureManifest.conversation.databaseRelativePath);
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE conversation_records (
      record_id TEXT PRIMARY KEY,
      origin_kind TEXT NOT NULL,
      headline TEXT,
      created_time REAL NOT NULL,
      finished_time REAL,
      last_seen REAL,
      visible_count INTEGER,
      tool_count INTEGER,
      model_name TEXT,
      profile_name TEXT,
      work_dir TEXT,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      snapshot_ref TEXT,
      legacy_body TEXT,
      raw_origin_json TEXT
    );
    CREATE TABLE message_records (
      message_id INTEGER PRIMARY KEY,
      conversation_ref TEXT NOT NULL,
      speaker TEXT NOT NULL,
      body TEXT,
      tool_label TEXT,
      occurred_at REAL NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_compacted INTEGER NOT NULL DEFAULT 0,
      view_kind TEXT,
      reasoning TEXT,
      api_payload TEXT,
      raw_calls TEXT
    );
    CREATE TABLE snapshot_records (
      fingerprint TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      raw_metadata TEXT
    );
  `);
  database.prepare("INSERT INTO snapshot_records VALUES (?, ?, ?)").run(
    "abcdef1234567890",
    "# Runtime prompt\n\napi_key: SYSTEM_PROMPT_CREDENTIAL_MARKER",
    "RAW_PROMPT_METADATA_MARKER",
  );

  const insertConversation = database.prepare(
    "INSERT INTO conversation_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const insertMessage = database.prepare(
    "INSERT INTO message_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const latestActivity = 1_788_886_980;
  for (let index = 1; index <= 6; index += 1) {
    const rawId = `RAW_SESSION_ID_MARKER_${index}`;
    const assistantTime = latestActivity - (index - 1) * 100;
    const startedTime = assistantTime - 60;
    const hasToolMessage = index === 1;
    insertConversation.run(
      rawId,
      "telegram",
      `Synthetic conversation ${index}`,
      startedTime,
      assistantTime,
      assistantTime,
      hasToolMessage ? 3 : 2,
      hasToolMessage ? 1 : 0,
      "fixture-model",
      "default",
      "fixture-workspace",
      0,
      0,
      "abcdef1234567890",
      "RAW_EMBEDDED_PROMPT_MARKER",
      "RAW_SESSION_ORIGIN_MARKER",
    );
    insertMessage.run(
      index * 10 + 1,
      rawId,
      "user",
      index === 1
        ? "Safe question\napi_key: CONVERSATION_CREDENTIAL_MARKER"
        : `Synthetic question ${index}`,
      null,
      startedTime + 10,
      1,
      0,
      null,
      "RAW_REASONING_MARKER",
      "RAW_API_PAYLOAD_MARKER",
      "RAW_CALLS_MARKER",
    );
    if (hasToolMessage) {
      insertMessage.run(
        index * 10 + 2,
        rawId,
        "tool",
        "RAW_TOOL_BODY_MARKER",
        "fixture-tool",
        startedTime + 20,
        1,
        0,
        null,
        "RAW_REASONING_MARKER",
        "RAW_API_PAYLOAD_MARKER",
        "RAW_CALLS_MARKER",
      );
    }
    insertMessage.run(
      index * 10 + 3,
      rawId,
      "assistant",
      index === 6 ? "Synthetic answer 6 with sixth-transcript-marker" : `Synthetic answer ${index}`,
      null,
      assistantTime,
      1,
      0,
      null,
      "RAW_REASONING_MARKER",
      "RAW_API_PAYLOAD_MARKER",
      "RAW_CALLS_MARKER",
    );
  }
  database.close();
  return databasePath;
}

function fixtureJob(index: number): Record<string, unknown> {
  const previousDay = String(8 + index).padStart(2, "0");
  const upcomingDay = String(10 + index).padStart(2, "0");
  return {
    task_key: `job-safe-${index}`,
    display_name: `Synthetic job ${index}`,
    cadence_spec: { cron_expression: index === 1 ? "0 9 * * *" : "30 14 * * *" },
    cadence_label: index === 1 ? "Daily at 09:00" : "Daily at 14:30",
    added_time: `2026-09-0${index}T01:00:00Z`,
    is_enabled: true,
    lifecycle_state: "enabled",
    previous_time: `2026-09-${previousDay}T01:00:00Z`,
    upcoming_time: `2026-09-${upcomingDay}T01:00:00Z`,
    result_state: index === 1 ? "success" : "failed",
    consecutive_failures: index === 1 ? 0 : 1,
    delivery_target: index === 1 ? "telegram:PRIVATE_RECIPIENT_MARKER" : "local",
    profile_alias: "default",
    single_capability: "fixture-skill",
    capability_list: ["fixture-skill"],
    toolset_list: ["file"],
    prompt: `RAW_JOB_PROMPT_MARKER_${index}`,
    script: `RAW_JOB_SCRIPT_MARKER_${index}`,
    credentials: { api_key: "CONFIG_CREDENTIAL_MARKER" },
  };
}

function writeJobSources(home: string): { databasePath: string; definitionsPath: string } {
  const jobsManifest = hermesFixtureManifest.jobs!;
  const definitionsPath = path.join(home, jobsManifest.definitionsRelativePath);
  writeFileSync(definitionsPath, JSON.stringify({
    task_items: [fixtureJob(1), fixtureJob(2)],
    raw_root: "RAW_JOBS_ROOT_MARKER",
  }), "utf8");

  const databasePath = path.join(home, jobsManifest.executionsDatabaseRelativePath);
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE attempt_records (
      attempt_key TEXT PRIMARY KEY,
      task_ref TEXT NOT NULL,
      attempt_state TEXT,
      claimed_time TEXT,
      begin_time TEXT,
      end_time TEXT,
      private_error TEXT,
      process_ref TEXT,
      raw_output TEXT
    );
  `);
  const insertExecution = database.prepare(
    "INSERT INTO attempt_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (let index = 1; index <= 2; index += 1) {
    const executionDay = String(8 + index).padStart(2, "0");
    insertExecution.run(
      `attempt-safe-${index}`,
      `job-safe-${index}`,
      index === 1 ? "completed" : "failed",
      `2026-09-${executionDay}T01:00:00Z`,
      `2026-09-${executionDay}T01:00:01Z`,
      `2026-09-${executionDay}T01:00:02Z`,
      `RAW_EXECUTION_ERROR_MARKER_${index}`,
      `RAW_PROCESS_MARKER_${index}`,
      `RAW_EXECUTION_OUTPUT_MARKER_${index}`,
    );
  }
  database.close();
  return { databasePath, definitionsPath };
}

function populateHermesFixture(root: string): HermesFixture {
  const home = path.join(root, "home");
  const workspace = path.join(root, "workspace");
  mkdirSync(path.join(home, "memories"), { recursive: true });
  mkdirSync(path.join(home, "skills", "research", "fixture-skill"), { recursive: true });
  mkdirSync(path.join(home, "scheduler"), { recursive: true });
  mkdirSync(path.join(workspace, "docs"), { recursive: true });
  mkdirSync(path.join(workspace, "empty"), { recursive: true });
  mkdirSync(path.join(workspace, "nested"), { recursive: true });

  const settingsPath = path.join(home, "settings.yaml");
  const memoryPath = path.join(home, "memories", "MEMORY.md");
  const userPath = path.join(home, "memories", "USER.md");
  const skillPath = path.join(home, "skills", "research", "fixture-skill", "SKILL.md");
  const soulPath = path.join(workspace, "SOUL.md");
  const agentsPath = path.join(workspace, "AGENTS.md");
  const docsPath = path.join(workspace, "docs", "notes.md");
  const nestedPath = path.join(workspace, "nested", "notes.md");
  const manualPath = path.join(workspace, "manual.pdf");

  writeFileSync(settingsPath, [
    "model:",
    "  default: fixture-model",
    "  provider: fixture-provider",
    "  api_key: CONFIG_CREDENTIAL_MARKER",
    "raw_config: RAW_CONFIG_MARKER",
    "platform_toolsets:",
    "  cli: [file]",
    "known_builtin_toolsets:",
    "  cli: [file, web]",
    "known_plugin_toolsets:",
    "  cli: []",
    "skills:",
    "  disabled: []",
  ].join("\n"), "utf8");
  writeFileSync(
    memoryPath,
    "# Memory\n\ndurable-browser-marker\n\napi_key: MEMORY_CREDENTIAL_MARKER",
    "utf8",
  );
  writeFileSync(userPath, "# User\n\npassword: USER_PASSWORD_MARKER", "utf8");
  writeFileSync(skillPath, [
    "---",
    "name: fixture-skill",
    "description: A safe synthetic skill.",
    "metadata:",
    "  hermes:",
    "    category: research",
    "---",
    "# Fixture Skill",
    "",
    "bounded-skill-marker",
    "",
    "<script>window.__cockpitSkillExecuted = true</script>",
    "",
    "![remote canary](https://remote.invalid/cockpit-skill.png)",
    "",
    '<iframe src="https://remote.invalid/cockpit-skill-frame"></iframe>',
    "",
    "api_key: SKILL_CREDENTIAL_MARKER",
  ].join("\n"), "utf8");
  writeFileSync(soulPath, "# Soul\n\nSynthetic principles.", "utf8");
  writeFileSync(agentsPath, "# Agents\n\nSynthetic rules.", "utf8");
  writeFileSync(docsPath, "# Notes\n\npassword=WORKSPACE_CREDENTIAL_MARKER", "utf8");
  writeFileSync(nestedPath, "# Nested notes\n\nnested-file-marker", "utf8");
  writeFileSync(manualPath, "%PDF-1.4 synthetic metadata-only fixture", "utf8");

  const conversationDatabasePath = writeConversationSources(home);
  const jobs = writeJobSources(home);
  const manifestPath = path.join(root, "source-manifest.json");
  writeFileSync(manifestPath, JSON.stringify(hermesFixtureManifest), "utf8");

  return {
    databaseFiles: [conversationDatabasePath, jobs.databasePath],
    environment: {
      COCKPIT_HERMES_HOME: home,
      COCKPIT_PLATFORM_HERMES_ROOT: home,
      COCKPIT_SOURCE_MANIFEST: manifestPath,
      COCKPIT_WORKSPACE_ROOT: workspace,
    },
    home,
    manifestPath,
    root,
    workspace,
  };
}

export function createHermesFixture(prefix = "cockpit-hermes-fixture-"): HermesFixture {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  try {
    return populateHermesFixture(root);
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function fingerprintSource(root: string, filename: string): HermesFixtureSourceFingerprint {
  const stats = statSync(filename, { bigint: true });
  return {
    hash: createHash("sha256").update(readFileSync(filename)).digest("hex"),
    label: path.relative(root, filename),
    mtimeNanoseconds: stats.mtimeNs.toString(),
    path: filename,
    size: stats.size.toString(),
  };
}

function listFixtureFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? listFixtureFiles(filename) : [filename];
  });
}

export function snapshotHermesFixtureSources(fixture: HermesFixture): HermesFixtureSourceSnapshot {
  // A read-only SQLite connection may create or update disposable shared-memory
  // coordination and may create an empty WAL alongside a WAL-mode database.
  // Existing WAL files remain ordinary fingerprinted sources.
  const allowedEmptyWalFiles = fixture.databaseFiles.map((databasePath) => `${databasePath}-wal`);
  const sharedMemoryFiles = fixture.databaseFiles.map((databasePath) => `${databasePath}-shm`);
  const existingSharedMemoryFiles = sharedMemoryFiles.filter((filename) => {
    const stats = lstatSync(filename, { throwIfNoEntry: false });
    if (!stats) return false;
    if (!stats.isFile()) throw new Error("SQLite coordination path is not a regular file.");
    return true;
  });
  const files = listFixtureFiles(fixture.root)
    .filter((filename) => !sharedMemoryFiles.includes(filename))
    .sort((left, right) => left.localeCompare(right, "en"))
    .map((filename) => fingerprintSource(fixture.root, filename));
  return {
    allowedEmptyWalFiles,
    existingSharedMemoryFiles,
    files,
    root: fixture.root,
    sharedMemoryFiles,
  };
}

export function assertHermesFixtureSourcesUnchanged(
  before: HermesFixtureSourceSnapshot,
): void {
  const changes: string[] = [];
  const expectedFiles = new Set(before.files.map((file) => file.path));
  const allowedEmptyWalFiles = new Set(before.allowedEmptyWalFiles);
  const existingSharedMemoryFiles = new Set(before.existingSharedMemoryFiles);
  const currentFiles = listFixtureFiles(before.root)
    .filter((filename) => !before.sharedMemoryFiles.includes(filename));

  for (const filename of before.sharedMemoryFiles) {
    const stats = lstatSync(filename, { throwIfNoEntry: false });
    const label = path.relative(before.root, filename);
    if (!stats) {
      if (existingSharedMemoryFiles.has(filename)) changes.push(`${label}: removed`);
    } else if (!stats.isFile()) {
      changes.push(`${label}: not a regular file`);
    }
  }

  for (const filename of before.allowedEmptyWalFiles) {
    if (expectedFiles.has(filename)) continue;
    const stats = lstatSync(filename, { throwIfNoEntry: false });
    if (!stats) continue;
    if (!stats.isFile()) {
      changes.push(`${path.relative(before.root, filename)}: not a regular file`);
    } else if (stats.size !== 0) {
      changes.push(`${path.relative(before.root, filename)}: created`);
    }
  }

  for (const filename of currentFiles) {
    if (!expectedFiles.has(filename)) {
      if (allowedEmptyWalFiles.has(filename)) continue;
      changes.push(`${path.relative(before.root, filename)}: created`);
    }
  }

  for (const expected of before.files) {
    if (!existsSync(expected.path)) {
      changes.push(`${expected.label}: removed`);
      continue;
    }
    const actual = fingerprintSource(before.root, expected.path);
    if (actual.hash !== expected.hash) changes.push(`${expected.label}: SHA-256 changed`);
    if (actual.mtimeNanoseconds !== expected.mtimeNanoseconds) changes.push(`${expected.label}: mtime changed`);
    if (actual.size !== expected.size) changes.push(`${expected.label}: size changed`);
  }
  if (changes.length > 0) {
    throw new Error(`Synthetic Hermes sources changed during read-only verification:\n${changes.join("\n")}`);
  }
}

export function removeHermesFixture(fixture: HermesFixture): void {
  rmSync(fixture.root, { recursive: true, force: true });
}
