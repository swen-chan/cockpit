import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { classifySourceError, logSafeDiagnostic, toSafeDiagnostic } from "@/server/security/errors";
import { openReadOnlyDatabase, withReadOnlyDatabase } from "@/server/sqlite/read-only";

function fingerprintFile(filename: string) {
  const contents = readFileSync(filename);
  const stats = statSync(filename, { bigint: true });
  return {
    contents,
    hash: createHash("sha256").update(contents).digest("hex"),
    mtimeNanoseconds: stats.mtimeNs,
    size: stats.size,
  };
}

describe("read-only SQLite foundation", () => {
  let fixtureRoot = "";
  let databasePath = "";

  beforeEach(() => {
    fixtureRoot = mkdtempSync(path.join(tmpdir(), "cockpit-sqlite-"));
    databasePath = path.join(fixtureRoot, "fixture.sqlite");
    const writer = new Database(databasePath);
    writer.exec(
      "CREATE TABLE fixture_records (id INTEGER PRIMARY KEY, label TEXT); INSERT INTO fixture_records (label) VALUES ('safe');",
    );
    writer.close();
  });

  afterEach(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  it("opens an existing database for bounded reads and rejects writes", async () => {
    const session = await openReadOnlyDatabase(databasePath, {
      busyTimeoutMs: 100,
      protectedSourceRoots: [fixtureRoot],
    });
    const { database } = session;
    const statement = database.prepare<[], { label: string }>(
      "SELECT label FROM fixture_records LIMIT 1",
    );
    expect(statement.get()).toEqual({ label: "safe" });
    expect("backup" in database).toBe(false);
    expect("exec" in database).toBe(false);
    expect("name" in database).toBe(false);
    expect("database" in statement).toBe(false);
    expect("iterate" in statement).toBe(false);
    expect("run" in statement).toBe(false);
    expect(() =>
      database.prepare("INSERT INTO fixture_records (label) VALUES ('blocked')"),
    ).toThrowError(expect.objectContaining({ code: "source_malformed" }));
    await session.close();

    const verifier = new Database(databasePath, { readonly: true });
    expect(verifier.prepare("SELECT label FROM fixture_records ORDER BY id").pluck().all()).toEqual(
      ["safe"],
    );
    verifier.close();
  });

  it("requires the database file to already exist", async () => {
    await expect(
      openReadOnlyDatabase(path.join(fixtureRoot, "missing.sqlite"), {
        protectedSourceRoots: [fixtureRoot],
      }),
    ).rejects.toMatchObject({ code: "missing_source" });
  });

  it("requires at least one protected source root", async () => {
    await expect(
      openReadOnlyDatabase(databasePath, {
        protectedSourceRoots: [],
      }),
    ).rejects.toMatchObject({ code: "source_malformed" });
  });

  it("rejects databases outside the canonical protected roots", async () => {
    const otherRoot = mkdtempSync(path.join(tmpdir(), "cockpit-sqlite-other-"));
    try {
      await expect(
        openReadOnlyDatabase(databasePath, {
          protectedSourceRoots: [otherRoot],
        }),
      ).rejects.toMatchObject({ code: "source_unavailable" });
    } finally {
      rmSync(otherRoot, { recursive: true, force: true });
    }
  });

  it("keeps the business database immutable while SQLite creates missing WAL coordination files", async () => {
    const writer = new Database(databasePath);
    writer.pragma("journal_mode = WAL");
    writer.close();
    rmSync(`${databasePath}-wal`, { force: true });
    rmSync(`${databasePath}-shm`, { force: true });
    const databaseBefore = fingerprintFile(databasePath);

    const row = await withReadOnlyDatabase(
      databasePath,
      (database) =>
        database.prepare("SELECT label FROM fixture_records LIMIT 1").get() as { label: string },
      { protectedSourceRoots: [fixtureRoot] },
    );

    expect(row.label).toBe("safe");
    expect(fingerprintFile(databasePath)).toEqual(databaseBefore);
    expect(readFileSync(`${databasePath}-wal`)).toHaveLength(0);
    expect(readFileSync(`${databasePath}-shm`).byteLength).toBeGreaterThan(0);
  });

  it("keeps the business database and live WAL immutable during a coordinated read", async () => {
    const writer = new Database(databasePath);
    writer.pragma("journal_mode = WAL");
    writer.pragma("wal_autocheckpoint = 0");
    writer.prepare("INSERT INTO fixture_records (label) VALUES (?)").run("live");
    const walPath = `${databasePath}-wal`;
    const databaseBefore = fingerprintFile(databasePath);
    const walBefore = fingerprintFile(walPath);
    expect(walBefore.size).toBeGreaterThan(0n);

    try {
      const labels = await withReadOnlyDatabase(
        databasePath,
        (database) =>
          (
            database.prepare("SELECT label FROM fixture_records ORDER BY id").all() as Array<{
              label: string;
            }>
          ).map((row) => row.label),
        { protectedSourceRoots: [fixtureRoot] },
      );
      expect(labels).toEqual(["safe", "live"]);
      expect(fingerprintFile(databasePath)).toEqual(databaseBefore);
      expect(fingerprintFile(walPath)).toEqual(walBefore);
    } finally {
      writer.close();
    }
  });

  it("keeps multi-step reads on one consistent WAL snapshot", async () => {
    const writer = new Database(databasePath);
    writer.pragma("journal_mode = WAL");
    writer.pragma("wal_autocheckpoint = 0");
    try {
      const counts = await withReadOnlyDatabase(
        databasePath,
        (database) => {
          const count = () =>
            database
              .prepare<[], { total: number }>("SELECT COUNT(*) AS total FROM fixture_records")
              .get()?.total;
          const before = count();
          writer.prepare("INSERT INTO fixture_records (label) VALUES (?)").run("concurrent");
          return [before, count()];
        },
        { protectedSourceRoots: [fixtureRoot] },
      );
      expect(counts).toEqual([1, 1]);
      expect(writer.prepare("SELECT COUNT(*) FROM fixture_records").pluck().get()).toBe(2);
    } finally {
      writer.close();
    }
  });

  it("maps busy errors to a safe code", () => {
    expect(classifySourceError({ code: "SQLITE_BUSY", message: `locked at ${databasePath}` })).toBe(
      "source_busy",
    );
  });

  it.each(["SQLITE_NOTADB", "SQLITE_FORMAT", "SQLITE_CORRUPT", "SQLITE_CORRUPT_VTAB"])(
    "maps malformed SQLite error %s to a safe code",
    (code) =>
      expect(classifySourceError({ code, message: `invalid at ${databasePath}` })).toBe(
        "source_malformed",
      ),
  );

  it("classifies an existing non-SQLite file as malformed", async () => {
    const invalidPath = path.join(fixtureRoot, "invalid.sqlite");
    writeFileSync(invalidPath, "not a sqlite database", "utf8");
    await expect(
      openReadOnlyDatabase(invalidPath, {
        protectedSourceRoots: [fixtureRoot],
      }),
    ).rejects.toMatchObject({ code: "source_malformed" });
  });

  it("maps busy errors raised during a read to source_busy", async () => {
    await expect(
      withReadOnlyDatabase(
        databasePath,
        () => {
          throw Object.assign(new Error("synthetic busy source"), { code: "SQLITE_BUSY" });
        },
        { protectedSourceRoots: [fixtureRoot] },
      ),
    ).rejects.toMatchObject({ code: "source_busy" });
  });

  it("does not include raw errors or private paths in diagnostics", () => {
    const diagnostic = toSafeDiagnostic(
      new Error(`failed at ${databasePath}`),
      "conversation-store",
      new Date("2026-08-28T00:00:00Z"),
    );
    expect(JSON.stringify(diagnostic)).not.toContain(databasePath);
    expect(diagnostic).toEqual({
      sourceId: "conversation-store",
      code: "source_unavailable",
      message: "The local source could not be read.",
      observedAt: "2026-08-28T00:00:00.000Z",
    });
  });

  it("logs only the bounded diagnostic identity and code", () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const diagnostic = toSafeDiagnostic(
      new Error(`token=private-value failed at ${databasePath}`),
      "conversation-store",
      new Date("2026-08-28T00:00:00Z"),
    );

    logSafeDiagnostic(diagnostic);

    expect(logger).toHaveBeenCalledWith("[cockpit] source request failed", {
      sourceId: "conversation-store",
      code: "source_unavailable",
    });
    expect(JSON.stringify(logger.mock.calls)).not.toContain("private-value");
    expect(JSON.stringify(logger.mock.calls)).not.toContain(databasePath);
  });
});
