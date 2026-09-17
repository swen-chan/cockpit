import "server-only";

import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";

import Database from "better-sqlite3";

import { classifySourceError, SourceSecurityError } from "@/server/security/errors";

export interface ReadOnlyDatabaseOptions {
  busyTimeoutMs?: number;
  protectedSourceRoots: readonly string[];
}

export interface ReadOnlyStatement<BindParameters extends unknown[] = unknown[], Result = unknown> {
  all: (...params: BindParameters) => Result[];
  columns: () => Database.ColumnDefinition[];
  get: (...params: BindParameters) => Result | undefined;
}

export interface ReadOnlyDatabase {
  prepare: <BindParameters extends unknown[] = unknown[], Result = unknown>(
    source: string,
  ) => ReadOnlyStatement<BindParameters, Result>;
}

export interface ReadOnlyDatabaseSession {
  database: ReadOnlyDatabase;
  close: () => Promise<void>;
}

function createReadOnlyStatement<BindParameters extends unknown[], Result>(
  statement: Database.Statement<BindParameters, Result>,
): ReadOnlyStatement<BindParameters, Result> {
  if (!statement.reader || !statement.readonly) throw new SourceSecurityError("source_malformed");
  return Object.freeze({
    all: (...params: BindParameters) => statement.all(...params),
    columns: () => statement.columns(),
    get: (...params: BindParameters) => statement.get(...params),
  });
}

function createReadOnlyDatabase(database: Database.Database): ReadOnlyDatabase {
  return Object.freeze({
    prepare: <BindParameters extends unknown[] = unknown[], Result = unknown>(source: string) =>
      createReadOnlyStatement(database.prepare<BindParameters, Result>(source)),
  });
}

function isFileSystemCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function isContained(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function normalizeSourceError(error: unknown): SourceSecurityError {
  return error instanceof SourceSecurityError
    ? error
    : new SourceSecurityError(classifySourceError(error));
}

async function resolveReadOnlySource(
  filename: string,
  protectedSourceRoots: readonly string[],
): Promise<string> {
  if (
    typeof filename !== "string" ||
    filename.length === 0 ||
    !Array.isArray(protectedSourceRoots) ||
    protectedSourceRoots.length < 1 ||
    protectedSourceRoots.length > 8 ||
    protectedSourceRoots.some((root) => typeof root !== "string" || root.length === 0)
  ) {
    throw new SourceSecurityError("source_malformed");
  }

  let canonicalFilename: string;
  let canonicalProtectedRoots: string[];
  try {
    [canonicalFilename, ...canonicalProtectedRoots] = await Promise.all([
      realpath(filename),
      ...protectedSourceRoots.map((root) => realpath(root)),
    ]);
  } catch (error) {
    if (isFileSystemCode(error, "ENOENT")) throw new SourceSecurityError("missing_source");
    throw new SourceSecurityError("source_unavailable");
  }

  if (!canonicalProtectedRoots.some((root) => isContained(root, canonicalFilename))) {
    throw new SourceSecurityError("source_unavailable");
  }

  let sourceHandle;
  try {
    sourceHandle = await open(canonicalFilename, constants.O_RDONLY | constants.O_NOFOLLOW);
    const sourceStat = await sourceHandle.stat();
    if (!sourceStat.isFile() || !Number.isSafeInteger(sourceStat.size)) {
      throw new SourceSecurityError("source_unavailable");
    }
  } catch (error) {
    if (isFileSystemCode(error, "ENOENT")) throw new SourceSecurityError("missing_source");
    throw normalizeSourceError(error);
  } finally {
    await sourceHandle?.close();
  }

  return canonicalFilename;
}

export async function openReadOnlyDatabase(
  filename: string,
  options: ReadOnlyDatabaseOptions,
): Promise<ReadOnlyDatabaseSession> {
  const timeout = options.busyTimeoutMs ?? 250;
  if (!Number.isInteger(timeout) || timeout < 0 || timeout > 5_000) {
    throw new SourceSecurityError("source_malformed");
  }

  let canonicalFilename: string;
  try {
    canonicalFilename = await resolveReadOnlySource(filename, options.protectedSourceRoots);
  } catch (error) {
    throw normalizeSourceError(error);
  }

  let database: Database.Database | undefined;
  try {
    database = new Database(canonicalFilename, {
      fileMustExist: true,
      readonly: true,
      timeout,
    });
    const openedDatabase = database;
    openedDatabase.pragma("query_only = ON");
    openedDatabase.pragma("schema_version", { simple: true });
    openedDatabase.pragma(`busy_timeout = ${timeout}`);
    openedDatabase.exec("BEGIN DEFERRED TRANSACTION");

    const readOnlyDatabase = createReadOnlyDatabase(openedDatabase);
    let closed = false;
    return {
      database: readOnlyDatabase,
      close: async () => {
        if (closed) return;
        let failure: SourceSecurityError | undefined;
        try {
          if (openedDatabase.inTransaction) openedDatabase.exec("ROLLBACK");
        } catch (error) {
          failure = normalizeSourceError(error);
        }
        try {
          if (openedDatabase.open) openedDatabase.close();
        } catch (error) {
          failure ??= normalizeSourceError(error);
        }
        closed = true;
        if (failure) throw failure;
      },
    };
  } catch (error) {
    const failure = normalizeSourceError(error);
    try {
      if (database?.inTransaction) database.exec("ROLLBACK");
      if (database?.open) database.close();
    } catch {}
    throw failure;
  }
}

export async function withReadOnlyDatabase<T>(
  filename: string,
  read: (database: ReadOnlyDatabase) => T | Promise<T>,
  options: ReadOnlyDatabaseOptions,
): Promise<T> {
  let session: ReadOnlyDatabaseSession | undefined;
  let outcome: { ok: true; value: T } | { error: SourceSecurityError; ok: false };
  try {
    session = await openReadOnlyDatabase(filename, options);
    outcome = { ok: true, value: await read(session.database) };
  } catch (error) {
    outcome = { error: normalizeSourceError(error), ok: false };
  }

  let closeError: SourceSecurityError | undefined;
  try {
    await session?.close();
  } catch (error) {
    closeError = normalizeSourceError(error);
  }
  if (!outcome.ok) throw outcome.error;
  if (closeError) throw closeError;
  return outcome.value;
}
