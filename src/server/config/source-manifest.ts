import "server-only";

import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";

import { z } from "zod";

import { SourceSecurityError } from "@/server/security/errors";

const sqlIdentifier = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/u);
const relativeSourcePath = z.string().min(1).max(500).refine((value) => (
  !value.startsWith("/") && !value.includes("\\") && !value.split("/").some((part) => !part || part === "." || part === "..")
));

const sessionColumnsSchema = z.object({
  id: sqlIdentifier,
  source: sqlIdentifier,
  title: sqlIdentifier.optional(),
  startedAt: sqlIdentifier,
  endedAt: sqlIdentifier.optional(),
  lastActivityAt: sqlIdentifier.optional(),
  messageCount: sqlIdentifier,
  toolCallCount: sqlIdentifier.optional(),
  model: sqlIdentifier.optional(),
  profileName: sqlIdentifier.optional(),
  workspace: sqlIdentifier.optional(),
  hidden: sqlIdentifier,
  archived: sqlIdentifier,
  promptHash: sqlIdentifier.optional(),
  embeddedPrompt: sqlIdentifier,
}).strict();

const messageColumnsSchema = z.object({
  id: sqlIdentifier,
  sessionId: sqlIdentifier,
  role: sqlIdentifier,
  content: sqlIdentifier,
  toolName: sqlIdentifier.optional(),
  timestamp: sqlIdentifier,
  active: sqlIdentifier,
  compacted: sqlIdentifier.optional(),
  displayKind: sqlIdentifier.optional(),
}).strict();

const jobDefinitionColumnsSchema = z.object({
  id: sqlIdentifier,
  name: sqlIdentifier,
  schedule: sqlIdentifier,
  scheduleDisplay: sqlIdentifier,
  createdAt: sqlIdentifier,
  enabled: sqlIdentifier,
  state: sqlIdentifier,
  lastRunAt: sqlIdentifier,
  nextRunAt: sqlIdentifier,
  lastStatus: sqlIdentifier,
  failureStreak: sqlIdentifier,
  deliver: sqlIdentifier,
  profile: sqlIdentifier,
  skill: sqlIdentifier,
  skills: sqlIdentifier,
  enabledToolsets: sqlIdentifier,
}).strict();

const jobScheduleColumnsSchema = z.object({
  display: sqlIdentifier,
  expression: sqlIdentifier,
  value: sqlIdentifier,
  runAt: sqlIdentifier,
}).strict();

const jobExecutionColumnsSchema = z.object({
  id: sqlIdentifier,
  jobId: sqlIdentifier,
  status: sqlIdentifier,
  claimedAt: sqlIdentifier,
  startedAt: sqlIdentifier,
  finishedAt: sqlIdentifier,
}).strict();

const jobsManifestSchema = z.object({
  definitionsRelativePath: relativeSourcePath,
  executionsDatabaseRelativePath: relativeSourcePath,
  rootJobsField: sqlIdentifier,
  definitionFields: jobDefinitionColumnsSchema,
  scheduleFields: jobScheduleColumnsSchema,
  executionTable: sqlIdentifier,
  executionColumns: jobExecutionColumnsSchema,
}).strict();

const sourceManifestSchema = z.object({
  configRelativePath: relativeSourcePath,
  conversation: z.object({
    databaseRelativePath: relativeSourcePath,
    sessionTable: sqlIdentifier,
    promptTable: sqlIdentifier.optional(),
    sessionColumns: sessionColumnsSchema,
    promptColumns: z.object({
      hash: sqlIdentifier,
      prompt: sqlIdentifier,
    }).strict().optional(),
    messages: z.object({
      table: sqlIdentifier,
      columns: messageColumnsSchema,
    }).strict().optional(),
  }).strict(),
  jobs: jobsManifestSchema.optional(),
}).strict().superRefine((manifest, context) => {
  const conversation = manifest.conversation;
  if (Boolean(conversation.promptTable) !== Boolean(conversation.promptColumns)) {
    context.addIssue({ code: "custom", message: "Prompt table and columns must be configured together." });
  }
  if (conversation.promptTable && !conversation.sessionColumns.promptHash) {
    context.addIssue({ code: "custom", message: "Prompt hash is required when a prompt table is configured." });
  }
});

export type PrivateSourceManifest = z.infer<typeof sourceManifestSchema>;
export type JobsManifest = z.infer<typeof jobsManifestSchema>;

const maxManifestBytes = 32 * 1_024;

export function readPrivateSourceManifest(filename: string): PrivateSourceManifest {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) throw new SourceSecurityError("missing_source");
    if (stat.size > maxManifestBytes) throw new SourceSecurityError("source_too_large");
    const parsed: unknown = JSON.parse(readFileSync(descriptor, "utf8"));
    const result = sourceManifestSchema.safeParse(parsed);
    if (!result.success) throw new SourceSecurityError("source_malformed");
    return result.data;
  } catch (error) {
    if (error instanceof SourceSecurityError) throw error;
    if (error instanceof SyntaxError) throw new SourceSecurityError("source_malformed");
    throw new SourceSecurityError("missing_source");
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch {}
    }
  }
}
