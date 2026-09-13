import "server-only";

import path from "node:path";

import { z } from "zod";

import type { HermesJob, JobExecution } from "@/contracts/cockpit";
import type { HermesContext } from "@/server/config/hermes-context";
import type { JobsManifest } from "@/server/config/source-manifest";
import { readNamedTextSource } from "@/server/files/bounded-text";
import { SourceSecurityError } from "@/server/security/errors";
import { SOURCE_LIMITS } from "@/server/security/limits";
import { containsSecrets } from "@/server/security/redaction";
import { withReadOnlyDatabase, type ReadOnlyDatabase } from "@/server/sqlite/read-only";

const sourceRecordSchema = z.record(z.string(), z.unknown());

interface ExecutionRow {
  safe_id: unknown;
  safe_job_key: unknown;
  safe_status: unknown;
  safe_claimed_at: unknown;
  safe_started_at: unknown;
  safe_finished_at: unknown;
  safe_recorded_attempts: unknown;
}

interface ExecutionSchema {
  table: string;
  id: string;
  jobId: string;
  status: string;
  claimedAt: string;
  startedAt: string;
  finishedAt: string;
}

export interface JobExecutionHistory {
  executions: JobExecution[];
  recordedAttempts: number;
}

const deliveryLabels = new Map([
  ["discord", "Discord"],
  ["email", "Email"],
  ["local", "Local files"],
  ["none", "No delivery"],
  ["origin", "Origin channel"],
  ["signal", "Signal"],
  ["slack", "Slack"],
  ["telegram", "Telegram"],
  ["webhook", "Webhook"],
  ["whatsapp", "WhatsApp"],
]);

function safeDate(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 1 || value.length > 80) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  const result = new Date(milliseconds);
  return Number.isNaN(result.valueOf()) ? null : result.toISOString();
}

function safeJobString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\u0000-\u001F\u007F]/gu, " ").trim();
  if (!normalized) return null;
  if (containsSecrets(normalized)) return null;
  return normalized.slice(0, maxLength);
}

function safeJobId(value: unknown): string | null {
  const id = safeJobString(value, 201);
  return id && id.length <= 200 ? id : null;
}

function safeSchedule(record: Record<string, unknown>, manifest: JobsManifest): string {
  const fields = manifest.definitionFields;
  const scheduleValue = record[fields.schedule];
  const candidates: unknown[] = [record[fields.scheduleDisplay]];
  if (typeof scheduleValue === "string") {
    candidates.push(scheduleValue);
  } else {
    const schedule = sourceRecordSchema.safeParse(scheduleValue);
    if (schedule.success) {
      const mapped = manifest.scheduleFields;
      candidates.push(
        schedule.data[mapped.display],
        schedule.data[mapped.expression],
        schedule.data[mapped.value],
        schedule.data[mapped.runAt],
      );
    }
  }
  for (const candidate of candidates) {
    const value = safeJobString(candidate, 200);
    if (value) return value;
  }
  return "Unspecified";
}

function safeState(record: Record<string, unknown>, manifest: JobsManifest): HermesJob["state"] {
  const fields = manifest.definitionFields;
  const rawState = record[fields.state];
  const state = typeof rawState === "string" ? rawState.trim().toLowerCase() : "";
  if (record[fields.enabled] === false || state === "paused") return state === "completed" ? "completed" : "paused";
  if (state === "completed") return "completed";
  if (state === "running") return "running";
  return "enabled";
}

function safeStatus(value: unknown): HermesJob["lastStatus"] {
  if (typeof value !== "string") return "never";
  const status = value.trim().toLowerCase();
  if (!status) return "never";
  switch (status) {
    case "ok":
    case "success":
    case "completed":
      return "success";
    case "error":
    case "failed":
      return "failed";
    case "claimed":
    case "running":
      return "running";
    case "unknown":
      return "unknown";
    default:
      return "unknown";
  }
}

function safeFailureStreak(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? Math.min(value, 1_000_000)
    : 0;
}

function safeDelivery(value: unknown): string {
  if (typeof value !== "string") return "Not configured";
  const platform = value.trim().split(":", 1)[0]?.toLowerCase() ?? "";
  return deliveryLabels.get(platform) ?? "Configured delivery";
}

function safeNameList(...values: unknown[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const candidates = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
    for (const candidate of candidates.slice(0, 100)) {
      const name = safeJobString(candidate, 100);
      if (!name) continue;
      const key = name.toLocaleLowerCase("en-US");
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(name);
      if (result.length >= 100) return result;
    }
  }
  return result;
}

function jobFromUnknown(value: unknown, context: HermesContext, manifest: JobsManifest): HermesJob {
  const parsed = sourceRecordSchema.safeParse(value);
  if (!parsed.success) throw new SourceSecurityError("source_malformed");
  const record = parsed.data;
  const fields = manifest.definitionFields;
  const id = safeJobId(record[fields.id]);
  if (!id) throw new SourceSecurityError("source_malformed");
  const state = safeState(record, manifest);
  return {
    id,
    name: safeJobString(record[fields.name], 200) ?? "Unnamed job",
    schedule: safeSchedule(record, manifest),
    createdAt: safeDate(record[fields.createdAt]),
    state,
    lastRun: safeDate(record[fields.lastRunAt]),
    nextRun: state === "enabled" || state === "running" ? safeDate(record[fields.nextRunAt]) : null,
    lastStatus: safeStatus(record[fields.lastStatus]),
    failureStreak: safeFailureStreak(record[fields.failureStreak]),
    delivery: safeDelivery(record[fields.deliver]),
    profile: safeJobString(record[fields.profile], 100) ?? safeJobString(context.profile, 100) ?? "Unavailable",
    toolsets: safeNameList(record[fields.skills], record[fields.skill], record[fields.enabledToolsets]),
    recordedAttempts: 0,
    executions: [],
  };
}

export async function readJobDefinitions(
  context: HermesContext,
  manifest: JobsManifest,
): Promise<HermesJob[]> {
  const source = await readNamedTextSource(context.home, manifest.definitionsRelativePath, {
    maxBytes: SOURCE_LIMITS.maxJobDefinitionBytes,
    maxCharacters: SOURCE_LIMITS.maxJobDefinitionBytes,
    rejectOversized: true,
  });
  let input: unknown;
  try {
    input = JSON.parse(source.text.replace(/^\uFEFF/u, ""));
  } catch {
    throw new SourceSecurityError("source_malformed");
  }
  const root = sourceRecordSchema.safeParse(input);
  const jobs = root.success ? root.data[manifest.rootJobsField] : null;
  if (!Array.isArray(jobs) || jobs.length > SOURCE_LIMITS.maxJobs) {
    throw new SourceSecurityError("source_malformed");
  }
  const result = jobs.map((job) => jobFromUnknown(job, context, manifest));
  if (new Set(result.map((job) => job.id)).size !== result.length) {
    throw new SourceSecurityError("source_malformed");
  }
  return result;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function inspectExecutionSchema(database: ReadOnlyDatabase, manifest: JobsManifest): ExecutionSchema {
  const table = quoteIdentifier(manifest.executionTable);
  const columns = database.prepare<[], { name: unknown }>(`PRAGMA table_info(${table})`).all();
  const names = new Set(columns.map((column) => column.name).filter((name): name is string => typeof name === "string"));
  const mapped = manifest.executionColumns;
  for (const required of Object.values(mapped)) {
    if (!names.has(required)) throw new SourceSecurityError("source_malformed");
  }
  return {
    table,
    id: quoteIdentifier(mapped.id),
    jobId: quoteIdentifier(mapped.jobId),
    status: quoteIdentifier(mapped.status),
    claimedAt: quoteIdentifier(mapped.claimedAt),
    startedAt: quoteIdentifier(mapped.startedAt),
    finishedAt: quoteIdentifier(mapped.finishedAt),
  };
}

function executionStatus(value: unknown): JobExecution["status"] {
  if (typeof value !== "string") return "unknown";
  switch (value.trim().toLowerCase()) {
    case "completed": return "success";
    case "failed": return "failed";
    case "claimed":
    case "running": return "running";
    default: return "unknown";
  }
}

function executionFromRow(row: ExecutionRow): { execution: JobExecution; jobId: string } {
  const id = safeJobId(row.safe_id);
  const jobId = safeJobId(row.safe_job_key);
  const startedAt = safeDate(row.safe_started_at) ?? safeDate(row.safe_claimed_at);
  if (!id || !jobId || !startedAt) throw new SourceSecurityError("source_malformed");
  return {
    jobId,
    execution: {
      id,
      status: executionStatus(row.safe_status),
      startedAt,
      finishedAt: safeDate(row.safe_finished_at),
    },
  };
}

export async function readRecentJobExecutions(
  context: HermesContext,
  manifest: JobsManifest,
  jobIds: readonly string[],
): Promise<Map<string, JobExecutionHistory>> {
  const uniqueIds = [...new Set(jobIds)].slice(0, SOURCE_LIMITS.maxJobs);
  const grouped = new Map<string, JobExecutionHistory>(
    uniqueIds.map((id) => [id, { executions: [], recordedAttempts: 0 }]),
  );
  if (uniqueIds.length === 0) return grouped;
  const databasePath = path.join(context.home, manifest.executionsDatabaseRelativePath);
  return withReadOnlyDatabase(databasePath, (database) => {
    const schema = inspectExecutionSchema(database, manifest);
    const placeholders = uniqueIds.map(() => "?").join(", ");
    const rows = database.prepare<[...string[], number], ExecutionRow>(`
      WITH ranked AS (
        SELECT
          ${schema.id} AS safe_id,
          ${schema.jobId} AS safe_job_key,
          ${schema.status} AS safe_status,
          ${schema.claimedAt} AS safe_claimed_at,
          ${schema.startedAt} AS safe_started_at,
          ${schema.finishedAt} AS safe_finished_at,
          ROW_NUMBER() OVER (PARTITION BY ${schema.jobId} ORDER BY ${schema.claimedAt} DESC, ${schema.id} DESC) AS safe_job_rank,
          COUNT(*) OVER (PARTITION BY ${schema.jobId}) AS safe_recorded_attempts
        FROM ${schema.table}
        WHERE ${schema.jobId} IN (${placeholders})
      )
      SELECT safe_id, safe_job_key, safe_status, safe_claimed_at, safe_started_at, safe_finished_at, safe_recorded_attempts
      FROM ranked
      WHERE safe_job_rank <= ?
      ORDER BY safe_claimed_at DESC, safe_id DESC
    `).all(...uniqueIds, SOURCE_LIMITS.maxExecutionsPerJob);
    for (const row of rows) {
      const { execution, jobId } = executionFromRow(row);
      const history = grouped.get(jobId);
      if (!history) continue;
      if (typeof row.safe_recorded_attempts !== "number"
        || !Number.isSafeInteger(row.safe_recorded_attempts)
        || row.safe_recorded_attempts < 0) {
        throw new SourceSecurityError("source_malformed");
      }
      history.recordedAttempts = Math.min(row.safe_recorded_attempts, 1_000_000);
      history.executions.push(execution);
    }
    return grouped;
  }, { protectedSourceRoots: [context.home] });
}
