import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jobsSnapshotSchema } from "@/contracts/source-result";
import { readJobDefinitions, readRecentJobExecutions } from "@/server/adapters/jobs";
import type { HermesContext } from "@/server/config/hermes-context";
import type { JobsManifest, PrivateSourceManifest } from "@/server/config/source-manifest";
import { SourceSecurityError } from "@/server/security/errors";
import { loadJobsPageData } from "@/server/services/jobs";

const jobsManifest: JobsManifest = {
  definitionsRelativePath: "scheduler/definitions.fixture.json",
  executionsDatabaseRelativePath: "scheduler/history.fixture.sqlite",
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
};

const privateManifest: PrivateSourceManifest = {
  configRelativePath: "settings.fixture.yaml",
  conversation: {
    databaseRelativePath: "conversations.fixture.sqlite",
    sessionTable: "conversation_records",
    sessionColumns: {
      id: "record_key",
      source: "source_kind",
      startedAt: "opened_time",
      messageCount: "entry_count",
      hidden: "hidden_flag",
      archived: "archived_flag",
      embeddedPrompt: "embedded_context",
    },
  },
  jobs: jobsManifest,
};

function contextFor(home: string): HermesContext {
  return { home, profile: "default", profileKind: "default", source: "platform-default" };
}

function safeJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    task_key: "job-one",
    display_name: "Daily research",
    cadence_label: "Every day at 09:30",
    added_time: "2026-08-01T08:15:00+08:00",
    is_enabled: true,
    lifecycle_state: "scheduled",
    previous_time: "2026-09-08T01:30:00Z",
    upcoming_time: "2026-09-09T01:30:00Z",
    result_state: "ok",
    consecutive_failures: 0,
    delivery_target: "telegram:-100123456789:42",
    capability_list: ["research", "token=secret-value"],
    toolset_list: ["web"],
    profile_alias: null,
    secret_instruction: "PRIVATE PROMPT",
    runner_location: "/private/job.py",
    private_endpoint: "https://private.example.test",
    private_error: "PRIVATE ERROR",
    private_claim: { token: "PRIVATE CLAIM" },
    private_origin: { recipient: "PRIVATE RECIPIENT" },
    ...overrides,
  };
}

describe("jobs adapters", () => {
  const roots: string[] = [];

  function fixture(): { context: HermesContext; home: string } {
    const home = mkdtempSync(path.join(tmpdir(), "cockpit-jobs-"));
    roots.push(home);
    mkdirSync(path.join(home, "scheduler"));
    return { context: contextFor(home), home };
  }

  function writeJobs(home: string, jobs: unknown): void {
    writeFileSync(
      path.join(home, jobsManifest.definitionsRelativePath),
      JSON.stringify({
        [jobsManifest.rootJobsField]: jobs,
        fixture_updated_time: "2026-09-09T00:00:00Z",
      }),
    );
  }

  function createExecutions(home: string): Database.Database {
    const database = new Database(path.join(home, jobsManifest.executionsDatabaseRelativePath));
    database.exec(`
      CREATE TABLE attempt_records (
        attempt_key TEXT PRIMARY KEY,
        task_ref TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        process_ref TEXT NOT NULL,
        process_number INTEGER NOT NULL,
        process_opened_time INTEGER,
        attempt_state TEXT NOT NULL,
        claimed_time TEXT NOT NULL,
        begin_time TEXT,
        end_time TEXT,
        private_error TEXT
      );
      CREATE INDEX fixture_attempt_lookup ON attempt_records(task_ref, claimed_time DESC, attempt_key DESC);
    `);
    return database;
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("constructs job DTOs from an explicit allowlist", async () => {
    const { context, home } = fixture();
    writeJobs(home, [safeJob()]);

    const jobs = await readJobDefinitions(context, jobsManifest);
    expect(jobs).toEqual([
      expect.objectContaining({
        id: "job-one",
        name: "Daily research",
        schedule: "Every day at 09:30",
        createdAt: "2026-08-01T00:15:00.000Z",
        state: "enabled",
        lastStatus: "success",
        delivery: "Telegram",
        profile: "default",
        toolsets: ["research", "web"],
        executions: [],
      }),
    ]);
    const serialized = JSON.stringify(jobs);
    for (const forbidden of [
      "PRIVATE PROMPT",
      "PRIVATE ERROR",
      "PRIVATE CLAIM",
      "PRIVATE RECIPIENT",
      "private.example.test",
      "-100123456789",
      "secret-value",
      "/private/job.py",
    ])
      expect(serialized).not.toContain(forbidden);
  });

  it("normalizes unusual schedules and paused or completed states", async () => {
    const { context, home } = fixture();
    writeJobs(home, [
      safeJob({
        task_key: "paused",
        is_enabled: false,
        lifecycle_state: "paused",
        cadence_label: null,
        cadence_spec: { cron_expression: "*/17 * * * *" },
      }),
      safeJob({
        task_key: "completed",
        is_enabled: false,
        lifecycle_state: "completed",
        cadence_label: "once",
        upcoming_time: "2026-12-01T00:00:00Z",
      }),
      safeJob({
        task_key: "odd",
        cadence_label: "https://private.example.test/schedule",
        cadence_spec: null,
      }),
      safeJob({ task_key: "unrecognized-result", result_state: "timed_out" }),
    ]);

    const jobs = await readJobDefinitions(context, jobsManifest);
    expect(jobs[0]).toMatchObject({
      id: "paused",
      state: "paused",
      schedule: "*/17 * * * *",
      nextRun: null,
    });
    expect(jobs[1]).toMatchObject({ id: "completed", state: "completed", nextRun: null });
    expect(jobs[2]).toMatchObject({ id: "odd", schedule: "https://private.example.test/schedule" });
    expect(jobs[3]).toMatchObject({ id: "unrecognized-result", lastStatus: "unknown" });
  });

  it("allows trusted allowlisted references while rejecting credentials", async () => {
    const { context, home } = fixture();
    writeJobs(home, [
      safeJob({
        display_name: "/opt/private/job.py",
        cadence_label: "internal.example.test:8443/schedule",
        profile_alias: "~/profiles/research.yaml",
        capability_list: [
          "research",
          "~/private/skill.md",
          "private.example.test/tool",
          "token=secret-value",
          "postgres://alice:s3cr3t@db.internal/jobs",
        ],
        toolset_list: [
          "web",
          "C:\\Users\\private\\tool.exe",
          "localhost:9000/admin",
          "[fd00::1]:8443/private",
          "https://internal/callback?access_token=supersecret123",
          "https://internal/callback#access_token=fragmentsecret123",
          "private.example.test/callback?access_token=schemelesssecret123",
          "//private.example.test/callback?access_token=relativesecret123",
        ],
      }),
    ]);

    const jobs = await readJobDefinitions(context, jobsManifest);
    expect(jobs[0]).toMatchObject({
      name: "/opt/private/job.py",
      schedule: "internal.example.test:8443/schedule",
      profile: "~/profiles/research.yaml",
      toolsets: [
        "research",
        "~/private/skill.md",
        "private.example.test/tool",
        "web",
        "C:\\Users\\private\\tool.exe",
        "localhost:9000/admin",
        "[fd00::1]:8443/private",
      ],
    });
    const serialized = JSON.stringify(jobs);
    expect(serialized).not.toContain("secret-value");
    expect(serialized).not.toContain("s3cr3t");
    expect(serialized).not.toContain("supersecret123");
    expect(serialized).not.toContain("fragmentsecret123");
    expect(serialized).not.toContain("schemelesssecret123");
    expect(serialized).not.toContain("relativesecret123");
  });

  it("rejects ambiguous definition identifiers", async () => {
    const duplicateDefinitions = fixture();
    writeJobs(duplicateDefinitions.home, [safeJob(), safeJob({ display_name: "Duplicate" })]);
    await expect(
      readJobDefinitions(duplicateDefinitions.context, jobsManifest),
    ).rejects.toMatchObject({ code: "source_malformed" });

    const overlongDefinition = fixture();
    writeJobs(overlongDefinition.home, [safeJob({ task_key: "x".repeat(201) })]);
    await expect(
      readJobDefinitions(overlongDefinition.context, jobsManifest),
    ).rejects.toMatchObject({ code: "source_malformed" });
  });

  it("uses the response schema's UTF-16 string limits", async () => {
    const { context, home } = fixture();
    writeJobs(home, [
      safeJob({
        display_name: "😀".repeat(101),
        capability_list: ["😀".repeat(51)],
        toolset_list: [],
      }),
    ]);

    const jobs = await readJobDefinitions(context, jobsManifest);
    expect(jobs[0]).toMatchObject({
      name: "😀".repeat(100),
      toolsets: ["😀".repeat(50)],
    });
    expect(
      jobsSnapshotSchema.safeParse({
        jobs,
        observedAt: "2026-09-09T00:00:00.000Z",
        definitionsState: "ready",
        executionsState: "ready",
      }).success,
    ).toBe(true);
  });

  it("allows local-path and endpoint-like identifiers from trusted sources", async () => {
    const localDefinition = fixture();
    writeJobs(localDefinition.home, [safeJob({ task_key: "/opt/private/job.py" })]);
    await expect(readJobDefinitions(localDefinition.context, jobsManifest)).resolves.toEqual([
      expect.objectContaining({ id: "/opt/private/job.py" }),
    ]);

    const endpointExecution = fixture();
    const database = createExecutions(endpointExecution.home);
    database
      .prepare(
        `
      INSERT INTO attempt_records
        (attempt_key, task_ref, source_kind, process_ref, process_number, attempt_state, claimed_time, begin_time, end_time, private_error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        "https://internal.example.test/attempt",
        "job-one",
        "cron",
        "PRIVATE PROCESS",
        1,
        "completed",
        "2026-09-09T02:00:00Z",
        null,
        null,
        null,
      );
    database.close();

    const histories = await readRecentJobExecutions(endpointExecution.context, jobsManifest, [
      "job-one",
    ]);
    expect(histories.get("job-one")?.executions[0]?.id).toBe(
      "https://internal.example.test/attempt",
    );
  });

  it("uses null when a job has no valid creation timestamp", async () => {
    const { context, home } = fixture();
    writeJobs(home, [safeJob({ added_time: "not-a-date" })]);

    const jobs = await readJobDefinitions(context, jobsManifest);
    expect(jobs[0]?.createdAt).toBeNull();
  });

  it("rejects missing, malformed, and structurally invalid definition sources", async () => {
    const missing = fixture();
    await expect(readJobDefinitions(missing.context, jobsManifest)).rejects.toMatchObject({
      code: "missing_source",
    });

    const malformed = fixture();
    writeFileSync(path.join(malformed.home, jobsManifest.definitionsRelativePath), "{not json");
    await expect(readJobDefinitions(malformed.context, jobsManifest)).rejects.toMatchObject({
      code: "source_malformed",
    });

    const invalid = fixture();
    writeJobs(invalid.home, [{ display_name: "Missing id" }]);
    await expect(readJobDefinitions(invalid.context, jobsManifest)).rejects.toMatchObject({
      code: "source_malformed",
    });
  });

  it("loads at most ten recent executions per job without selecting private columns", async () => {
    const { context, home } = fixture();
    const database = createExecutions(home);
    const insert = database.prepare(`
      INSERT INTO attempt_records
        (attempt_key, task_ref, source_kind, process_ref, process_number, attempt_state, claimed_time, begin_time, end_time, private_error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (let index = 0; index < 12; index += 1) {
      const timestamp = new Date(Date.UTC(2026, 8, 9, 0, index)).toISOString();
      insert.run(
        `execution-${index}`,
        "job-one",
        "cron",
        "PRIVATE PROCESS",
        9999,
        index === 11 ? "failed" : "completed",
        timestamp,
        timestamp,
        timestamp,
        "PRIVATE ERROR",
      );
    }
    insert.run(
      "execution-two",
      "job-two",
      "cron",
      "PRIVATE PROCESS",
      9999,
      "unknown",
      "2026-09-09T02:00:00Z",
      null,
      "2026-09-09T02:01:00Z",
      "PRIVATE ERROR",
    );
    database.close();

    const executions = await readRecentJobExecutions(context, jobsManifest, ["job-one", "job-two"]);
    expect(executions.get("job-one")?.executions).toHaveLength(10);
    expect(executions.get("job-one")?.recordedAttempts).toBe(12);
    expect(executions.get("job-one")?.executions[0]).toMatchObject({ status: "failed" });
    expect(executions.get("job-two")?.recordedAttempts).toBe(1);
    expect(executions.get("job-two")?.executions[0]).toMatchObject({ status: "unknown" });
    const serialized = JSON.stringify([...executions.values()]);
    expect(serialized).not.toContain("PRIVATE PROCESS");
    expect(serialized).not.toContain("PRIVATE ERROR");
    expect(serialized).not.toContain("9999");
  });

  it("preserves definitions when the execution ledger is unavailable", async () => {
    const { home } = fixture();
    writeJobs(home, [safeJob()]);
    const page = await loadJobsPageData({
      platformRoot: home,
      manifest: privateManifest,
      definitionReader: readJobDefinitions,
      executionReader: async () => {
        throw new SourceSecurityError("missing_source");
      },
      now: new Date("2026-09-09T03:00:00Z"),
    });

    expect(page.jobs).toHaveLength(1);
    expect(page.definitionsState).toBe("ready");
    expect(page.executionsState).toBe("unavailable");
    expect(page.failures).toEqual([
      expect.objectContaining({ sourceId: "job-executions", code: "missing_source" }),
    ]);
  });

  it("returns a strict no-store jobs snapshot from the GET route", async () => {
    const { home } = fixture();
    writeJobs(home, [safeJob()]);
    createExecutions(home).close();
    const manifestPath = path.join(home, "cockpit.fixture.json");
    writeFileSync(manifestPath, JSON.stringify(privateManifest));
    vi.stubEnv("COCKPIT_HERMES_HOME", home);
    vi.stubEnv("COCKPIT_SOURCE_MANIFEST", manifestPath);

    const route = await import("@/app/api/jobs/route");
    const response = await route.GET(new Request("http://127.0.0.1:3000/api/jobs"));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(jobsSnapshotSchema.safeParse(payload).success).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("PRIVATE PROMPT");
  });
});
