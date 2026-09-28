// @vitest-environment node
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createOwnedTemp, type OwnedTemp } from "@/server/codex/owned-temp.mjs";
import { createSnapshot, type SnapshotInput } from "@/server/codex/snapshot-worker.mjs";

const firstId = "11111111-1111-4111-8111-000000000001";
const secondId = "11111111-1111-4111-8111-000000000002";
const missingId = "11111111-1111-4111-8111-000000000003";
const DATABASE_CAP = 512 * 1024 * 1024;
const SHM_CAP = 64 * 1024 * 1024;

function fingerprint(filename: string) {
  const stat = lstatSync(filename, { bigint: true });
  return {
    hash: createHash("sha256").update(readFileSync(filename)).digest("hex"),
    size: stat.size,
    mtime: stat.mtimeNs,
  };
}

describe("Codex private online-backup worker", () => {
  let fixture: string;
  let sourceHome: string;
  let sourceDatabase: string;
  let sessions: string;
  let archived: string;
  let rollout: string;
  let owner: OwnedTemp;
  let input: SnapshotInput;
  let writer: Database.Database | undefined;

  beforeEach(() => {
    fixture = realpathSync(mkdtempSync(path.join(realpathSync("/tmp"), "cockpit-snapshot-test-")));
    chmodSync(fixture, 0o700);
    sourceHome = path.join(fixture, "synthetic-source");
    sessions = path.join(sourceHome, "sessions");
    archived = path.join(sourceHome, "archived_sessions");
    mkdirSync(sessions, { recursive: true, mode: 0o700 });
    mkdirSync(archived, { mode: 0o700 });
    sourceDatabase = path.join(sourceHome, "state_5.sqlite");
    rollout = path.join(sessions, "synthetic.jsonl");
    writeFileSync(rollout, "synthetic selected rollout\n", { mode: 0o600 });
    const database = new Database(sourceDatabase);
    database.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT, title TEXT)");
    const insert = database.prepare("INSERT INTO threads VALUES (?, ?, ?)");
    insert.run(firstId, rollout, "synthetic first title");
    insert.run(secondId, path.join(sessions, "not-copied.jsonl"), "synthetic second title");
    insert.run(missingId, null, "synthetic null path");
    database.close();
    owner = createOwnedTemp({ parent: path.join(fixture, "temp-parent") });
    input = {
      sourceDatabase,
      destinationDatabase: path.join(owner.directory, "state_5.sqlite"),
      placeholder: path.join(owner.directory, "placeholder.jsonl"),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    writer?.close();
    writer = undefined;
    owner.cleanup();
    rmSync(fixture, { recursive: true, force: true });
  });

  function reading(selectedTaskId = firstId): SnapshotInput {
    return {
      ...input,
      selectedTaskId,
      allowedRolloutRoots: [sessions, archived],
      destinationRollout: path.join(owner.directory, "selected.jsonl"),
    };
  }

  function mutate(callback: (database: Database.Database) => void) {
    const database = new Database(sourceDatabase);
    try {
      callback(database);
    } finally {
      database.close();
    }
  }

  function rows() {
    const database = new Database(input.destinationDatabase, { readonly: true });
    try {
      return database.prepare("SELECT id, rollout_path, title FROM threads ORDER BY id").all();
    } finally {
      database.close();
    }
  }

  function noWorkerFiles() {
    expect(readdirSync(owner.directory)).toEqual([".cockpit-owner.json"]);
  }

  function runStandalone(request: Buffer, closeInput = false) {
    const worker = fileURLToPath(
      new URL("../../src/server/codex/snapshot-worker.mjs", import.meta.url),
    );
    return new Promise<{ stdout: string; stderr: string; code: number | null }>(
      (resolve, reject) => {
        const child = spawn(process.execPath, ["--conditions=react-server", worker], {
          // Next augments ProcessEnv with required NODE_ENV; the sterile worker deliberately omits it.
          cwd: owner.directory,
          env: {
            PATH: "/usr/bin:/bin",
            HOME: owner.directory,
            TMPDIR: owner.directory,
            LANG: "C",
          } as unknown as NodeJS.ProcessEnv,
          stdio: ["pipe", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("synthetic worker timeout"));
        }, 2000);
        child.stdout.on("data", (bytes: Buffer) => {
          stdout += bytes.toString("utf8");
        });
        child.stderr.on("data", (bytes: Buffer) => {
          stderr += bytes.toString("utf8");
        });
        child.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve({ stdout, stderr, code });
        });
        if (closeInput) child.stdin.end(request);
        else child.stdin.write(request);
      },
    );
  }

  it("scrubs every non-null query-visible path, preserves nulls and unrelated fields, and leaves sources unchanged", async () => {
    const before = fingerprint(sourceDatabase);
    const rolloutBefore = fingerprint(rollout);
    expect(await createSnapshot(input)).toEqual({ ok: true });
    expect(rows()).toEqual([
      { id: firstId, rollout_path: input.placeholder, title: "synthetic first title" },
      { id: secondId, rollout_path: input.placeholder, title: "synthetic second title" },
      { id: missingId, rollout_path: null, title: "synthetic null path" },
    ]);
    expect(readFileSync(input.placeholder)).toHaveLength(0);
    expect(lstatSync(input.placeholder).mode & 0o7777).toBe(0o600);
    expect(lstatSync(input.destinationDatabase).mode & 0o7777).toBe(0o600);
    expect(readdirSync(owner.directory).sort()).toEqual([
      ".cockpit-owner.json",
      "placeholder.jsonl",
      "state_5.sqlite",
    ]);
    expect(fingerprint(sourceDatabase)).toEqual(before);
    expect(fingerprint(rollout)).toEqual(rolloutBefore);
  });

  it("online backup includes active committed WAL data without changing the real main DB or non-empty WAL", async () => {
    writer = new Database(sourceDatabase);
    writer.pragma("journal_mode = WAL");
    writer.pragma("wal_autocheckpoint = 0");
    writer
      .prepare("UPDATE threads SET title = ? WHERE id = ?")
      .run("committed live WAL title", firstId);
    const mainBefore = fingerprint(sourceDatabase);
    const walBefore = fingerprint(`${sourceDatabase}-wal`);
    expect(walBefore.size).toBeGreaterThan(0n);
    expect(await createSnapshot(input)).toEqual({ ok: true });
    expect(rows()[0]).toMatchObject({
      title: "committed live WAL title",
      rollout_path: input.placeholder,
    });
    expect(fingerprint(sourceDatabase)).toEqual(mainBefore);
    expect(fingerprint(`${sourceDatabase}-wal`)).toEqual(walBefore);
  });

  it.each([
    { journal: "DELETE", checkpoint: false },
    { journal: "WAL", checkpoint: false },
    { journal: "WAL", checkpoint: true },
  ])(
    "keeps a consistent completed backup when another connection commits afterward ($journal, checkpoint=$checkpoint)",
    async ({ journal, checkpoint }) => {
      writer = new Database(sourceDatabase);
      writer.pragma(`journal_mode = ${journal}`);
      writer.pragma("wal_autocheckpoint = 0");
      const rolloutBefore = fingerprint(rollout);
      const phases: string[] = [];
      let sourceAfterCommit: ReturnType<typeof fingerprint> | undefined;
      let walAfterCommit: ReturnType<typeof fingerprint> | undefined;
      const result = await createSnapshot(input, {
        onPhase(phase) {
          phases.push(phase);
          writer!
            .prepare("UPDATE threads SET title = ? WHERE id = ?")
            .run("committed after backup", firstId);
          if (checkpoint) writer!.pragma("wal_checkpoint(TRUNCATE)");
          sourceAfterCommit = fingerprint(sourceDatabase);
          if (existsSync(`${sourceDatabase}-wal`))
            walAfterCommit = fingerprint(`${sourceDatabase}-wal`);
        },
      });
      expect(result).toEqual({ ok: true });
      expect(phases).toEqual(["after-backup"]);
      const copy = new Database(input.destinationDatabase, { readonly: true });
      try {
        expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
      } finally {
        copy.close();
      }
      expect(rows()).toEqual([
        { id: firstId, rollout_path: input.placeholder, title: "synthetic first title" },
        { id: secondId, rollout_path: input.placeholder, title: "synthetic second title" },
        { id: missingId, rollout_path: null, title: "synthetic null path" },
      ]);
      expect(
        writer.prepare("SELECT id, rollout_path, title FROM threads ORDER BY id").all(),
      ).toEqual([
        { id: firstId, rollout_path: rollout, title: "committed after backup" },
        {
          id: secondId,
          rollout_path: path.join(sessions, "not-copied.jsonl"),
          title: "synthetic second title",
        },
        { id: missingId, rollout_path: null, title: "synthetic null path" },
      ]);
      expect(fingerprint(sourceDatabase)).toEqual(sourceAfterCommit);
      if (walAfterCommit) expect(fingerprint(`${sourceDatabase}-wal`)).toEqual(walAfterCommit);
      expect(fingerprint(rollout)).toEqual(rolloutBefore);
    },
  );

  it("online backup stays consistent when another connection commits between page transfers", async () => {
    writer = new Database(sourceDatabase);
    writer.pragma("journal_mode = WAL");
    writer.pragma("wal_autocheckpoint = 0");
    writer.exec("CREATE TABLE padding (data BLOB)");
    const insert = writer.prepare("INSERT INTO padding VALUES (zeroblob(4096))");
    writer.transaction(() => {
      for (let index = 0; index < 220; index += 1) insert.run();
    })();
    expect(writer.pragma("page_count", { simple: true })).toBeGreaterThan(100);
    const originalBackup = Database.prototype.backup;
    let committedBetweenTransfers = false;
    let sourceAfterCommit: ReturnType<typeof fingerprint> | undefined;
    let walAfterCommit: ReturnType<typeof fingerprint> | undefined;
    const rolloutBefore = fingerprint(rollout);
    vi.spyOn(Database.prototype, "backup").mockImplementation(function (
      this: Database.Database,
      filename,
      options,
    ) {
      return originalBackup.call(this, filename, {
        ...options,
        progress(progress) {
          if (
            !committedBetweenTransfers &&
            progress.remainingPages > 0 &&
            progress.remainingPages < progress.totalPages
          ) {
            writer!.transaction(() => {
              const update = writer!.prepare("UPDATE threads SET title = ? WHERE id = ?");
              update.run("concurrent first title", firstId);
              update.run("concurrent second title", secondId);
            })();
            committedBetweenTransfers = true;
            sourceAfterCommit = fingerprint(sourceDatabase);
            walAfterCommit = fingerprint(`${sourceDatabase}-wal`);
          }
          // The pinned backup library defaults to 100 pages when progress returns undefined.
          return options?.progress?.(progress) ?? 100;
        },
      });
    });
    expect(await createSnapshot(input)).toEqual({ ok: true });
    expect(committedBetweenTransfers).toBe(true);
    const copy = new Database(input.destinationDatabase, { readonly: true });
    try {
      expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(copy.prepare("SELECT COUNT(*) AS count FROM padding").get()).toEqual({ count: 220 });
    } finally {
      copy.close();
    }
    expect(rows()).toEqual([
      { id: firstId, rollout_path: input.placeholder, title: "concurrent first title" },
      { id: secondId, rollout_path: input.placeholder, title: "concurrent second title" },
      { id: missingId, rollout_path: null, title: "synthetic null path" },
    ]);
    expect(fingerprint(sourceDatabase)).toEqual(sourceAfterCommit);
    expect(fingerprint(`${sourceDatabase}-wal`)).toEqual(walAfterCommit);
    expect(fingerprint(rollout)).toEqual(rolloutBefore);
  });

  it("restores only the selected row to one copied rollout and leaves all real rollouts unchanged", async () => {
    const detail = reading();
    const mainBefore = fingerprint(sourceDatabase);
    const rolloutBefore = fingerprint(rollout);
    expect(await createSnapshot(detail)).toEqual({ ok: true });
    expect(rows()).toEqual([
      { id: firstId, rollout_path: detail.destinationRollout, title: "synthetic first title" },
      { id: secondId, rollout_path: input.placeholder, title: "synthetic second title" },
      { id: missingId, rollout_path: null, title: "synthetic null path" },
    ]);
    expect(readFileSync(detail.destinationRollout!, "utf8")).toBe("synthetic selected rollout\n");
    expect(lstatSync(detail.destinationRollout!).mode & 0o7777).toBe(0o600);
    expect(fingerprint(sourceDatabase)).toEqual(mainBefore);
    expect(fingerprint(rollout)).toEqual(rolloutBefore);
  });

  it("allows exactly one selected archived rollout", async () => {
    const archivedRollout = path.join(archived, "archived.jsonl");
    writeFileSync(archivedRollout, "synthetic archived\n", { mode: 0o600 });
    mutate((database) =>
      database
        .prepare("UPDATE threads SET rollout_path = ? WHERE id = ?")
        .run(archivedRollout, firstId),
    );
    const detail = reading();
    expect(await createSnapshot(detail)).toEqual({ ok: true });
    expect(readFileSync(detail.destinationRollout!, "utf8")).toBe("synthetic archived\n");
  });

  it.each([missingId, "11111111-1111-4111-8111-000000000004"])(
    "rejects missing or null-path selected tasks (%s)",
    async (id) => {
      expect(await createSnapshot(reading(id))).toEqual({ ok: false, code: "missing_source" });
      noWorkerFiles();
    },
  );

  it.each(["missing-table", "view", "wrong-column", "non-uuid", "blob-path", "null-id"])(
    "rejects a malformed private seam without returning or modifying source fields (%s)",
    async (kind) => {
      mutate((database) => {
        if (kind === "missing-table") database.exec("DROP TABLE threads");
        if (kind === "view")
          database.exec(
            "ALTER TABLE threads RENAME TO original; CREATE VIEW threads AS SELECT * FROM original",
          );
        if (kind === "wrong-column")
          database.exec("DROP TABLE threads; CREATE TABLE threads (id INTEGER, rollout_path TEXT)");
        if (kind === "non-uuid")
          database
            .prepare("UPDATE threads SET id = ? WHERE id = ?")
            .run("private raw malformed id", firstId);
        if (kind === "blob-path")
          database
            .prepare("UPDATE threads SET rollout_path = ? WHERE id = ?")
            .run(Buffer.from("private blob path"), firstId);
        if (kind === "null-id")
          database.prepare("UPDATE threads SET id = NULL WHERE id = ?").run(firstId);
      });
      const before = fingerprint(sourceDatabase);
      expect(await createSnapshot(input)).toEqual({ ok: false, code: "source_malformed" });
      expect(fingerprint(sourceDatabase)).toEqual(before);
      noWorkerFiles();
    },
  );

  it("rejects a duplicate selected identity rather than choosing an arbitrary row", async () => {
    mutate((database) => {
      database.exec(
        "ALTER TABLE threads RENAME TO original; CREATE TABLE threads (id TEXT, rollout_path TEXT); INSERT INTO threads SELECT id, rollout_path FROM original",
      );
      database.prepare("INSERT INTO threads VALUES (?, ?)").run(firstId, rollout);
    });
    expect(await createSnapshot(reading())).toEqual({ ok: false, code: "source_malformed" });
    noWorkerFiles();
  });

  it("verifies the affected row count and rolls back an ignored scrub", async () => {
    mutate((database) =>
      database.exec(
        "CREATE TRIGGER prevent_scrub BEFORE UPDATE OF rollout_path ON threads BEGIN SELECT RAISE(IGNORE); END",
      ),
    );
    const before = fingerprint(sourceDatabase);
    expect(await createSnapshot(input)).toEqual({ ok: false, code: "source_malformed" });
    expect(fingerprint(sourceDatabase)).toEqual(before);
    noWorkerFiles();
  });

  it.each(["main", "wal", "shm"])(
    "rejects exact source companion symlinks before SQLite opens (%s)",
    async (kind) => {
      const filename = kind === "main" ? sourceDatabase : `${sourceDatabase}-${kind}`;
      if (kind === "main") rmSync(filename);
      const target = path.join(fixture, `foreign-${kind}`);
      writeFileSync(target, "synthetic foreign");
      symlinkSync(target, filename);
      expect(await createSnapshot(input)).toEqual({ ok: false, code: "source_unavailable" });
      noWorkerFiles();
      expect(readFileSync(target, "utf8")).toBe("synthetic foreign");
    },
  );

  it.each(["main", "wal", "shm"])(
    "rejects FIFO sources before any potentially blocking file open (%s)",
    async (kind) => {
      const filename = kind === "main" ? sourceDatabase : `${sourceDatabase}-${kind}`;
      if (kind === "main") rmSync(filename);
      execFileSync("/usr/bin/mkfifo", [filename], {
        env: { PATH: "/usr/bin:/bin" } as unknown as NodeJS.ProcessEnv,
      });
      expect(lstatSync(filename).isFIFO()).toBe(true);
      expect(await createSnapshot(input)).toEqual({ ok: false, code: "source_unavailable" });
      noWorkerFiles();
    },
  );

  it("requires the source file UID to match the effective UID without chown or elevated fixture writes", async () => {
    const currentUid = process.geteuid!();
    vi.spyOn(process, "geteuid")
      .mockImplementationOnce(() => currentUid)
      .mockReturnValue(currentUid + 1);
    expect(await createSnapshot(input)).toEqual({ ok: false, code: "source_unavailable" });
    noWorkerFiles();
  });

  it("returns source_busy for a real locked SQLite source and leaves no produced files", async () => {
    // better-sqlite3 13.0.3 backup.cpp returns zero-page progress on initial BUSY;
    // backup.js treats remainingPages=0 as done. Fixed readonly page_count must
    // therefore classify this real lock before an empty copy looks malformed.
    writer = new Database(sourceDatabase);
    writer.exec("BEGIN EXCLUSIVE");
    expect(await createSnapshot(input)).toEqual({ ok: false, code: "source_busy" });
    noWorkerFiles();
  });

  it.each(["main", "combined-wal", "shm"])(
    "enforces preflight byte caps without opening oversized synthetic files (%s)",
    async (kind) => {
      if (kind === "main") truncateSync(sourceDatabase, DATABASE_CAP + 1);
      if (kind === "combined-wal") {
        writeFileSync(`${sourceDatabase}-wal`, "");
        truncateSync(`${sourceDatabase}-wal`, DATABASE_CAP);
      }
      if (kind === "shm") {
        writeFileSync(`${sourceDatabase}-shm`, "");
        truncateSync(`${sourceDatabase}-shm`, SHM_CAP + 1);
      }
      expect(await createSnapshot(input)).toEqual({ ok: false, code: "source_too_large" });
      noWorkerFiles();
    },
  );

  it("rejects backup progress above the byte cap and cleans the produced files", async () => {
    const originalBackup = Database.prototype.backup;
    const sourceBefore = fingerprint(sourceDatabase);
    let reportedOversizedProgress = false;
    vi.spyOn(Database.prototype, "backup").mockImplementation(function (
      this: Database.Database,
      filename,
      options,
    ) {
      const pageSize = this.pragma("page_size", { simple: true }) as number;
      return originalBackup.call(this, filename, {
        ...options,
        progress(progress) {
          reportedOversizedProgress = true;
          // Preserve the pinned library's default 100-page transfer size.
          return (
            options?.progress?.({
              ...progress,
              totalPages: Math.floor(DATABASE_CAP / pageSize) + 1,
            }) ?? 100
          );
        },
      });
    });
    expect(await createSnapshot(input)).toEqual({ ok: false, code: "source_too_large" });
    expect(reportedOversizedProgress).toBe(true);
    expect(fingerprint(sourceDatabase)).toEqual(sourceBefore);
    noWorkerFiles();
  });

  it("rejects a completed backup above the byte cap and cleans the produced files", async () => {
    const originalBackup = Database.prototype.backup;
    const sourceBefore = fingerprint(sourceDatabase);
    vi.spyOn(Database.prototype, "backup").mockImplementation(async function (
      this: Database.Database,
      filename,
      options,
    ) {
      const result = await originalBackup.call(this, filename, options);
      truncateSync(filename, DATABASE_CAP + 1);
      return result;
    });
    expect(await createSnapshot(input)).toEqual({ ok: false, code: "source_too_large" });
    expect(fingerprint(sourceDatabase)).toEqual(sourceBefore);
    noWorkerFiles();
  });

  it("rejects a source rollout outside the fixed roots and cleans its own failed backup", async () => {
    const outside = path.join(sourceHome, "not-approved.jsonl");
    writeFileSync(outside, "synthetic outside\n");
    mutate((database) =>
      database.prepare("UPDATE threads SET rollout_path = ? WHERE id = ?").run(outside, firstId),
    );
    expect(await createSnapshot(reading())).toEqual({ ok: false, code: "source_unavailable" });
    noWorkerFiles();
    expect(readFileSync(outside, "utf8")).toBe("synthetic outside\n");
  });

  it("rejects a selected rollout symlink instead of following it", async () => {
    const target = path.join(sessions, "real-target.jsonl");
    writeFileSync(target, "synthetic target\n");
    rmSync(rollout);
    symlinkSync(target, rollout);
    expect(await createSnapshot(reading())).toEqual({ ok: false, code: "source_unavailable" });
    noWorkerFiles();
  });

  it("rejects unknown arguments, partial detail arguments, and unauthenticated non-UUID identities", async () => {
    for (const candidate of [
      { ...input, privatePath: sourceHome },
      { ...input, selectedTaskId: firstId },
      { ...reading(), selectedTaskId: "raw-private-id" },
    ]) {
      expect(await createSnapshot(candidate as SnapshotInput)).toEqual({
        ok: false,
        code: "source_malformed",
      });
      noWorkerFiles();
    }
  });

  it("requires canonical owned output containment and never overwrites an existing destination", async () => {
    const outside = path.join(fixture, "outside.jsonl");
    expect(await createSnapshot({ ...input, placeholder: outside })).toEqual({
      ok: false,
      code: "source_unavailable",
    });
    writeFileSync(input.destinationDatabase, "existing private destination", { mode: 0o600 });
    expect(await createSnapshot(input)).toEqual({ ok: false, code: "source_unavailable" });
    expect(readFileSync(input.destinationDatabase, "utf8")).toBe("existing private destination");
    expect(existsSync(outside)).toBe(false);
  });

  it("removes only newly created files when an existing placeholder prevents completion", async () => {
    writeFileSync(input.placeholder, "existing private placeholder", { mode: 0o600 });
    expect(await createSnapshot(input)).toEqual({ ok: false, code: "source_unavailable" });
    expect(existsSync(input.destinationDatabase)).toBe(false);
    expect(readFileSync(input.placeholder, "utf8")).toBe("existing private placeholder");
  });

  it("honors cancellation without claiming a cooperative check is the hard deadline", async () => {
    const abort = new AbortController();
    abort.abort();
    expect(await createSnapshot(input, { signal: abort.signal })).toEqual({
      ok: false,
      code: "source_busy",
    });
    noWorkerFiles();
  });

  it("returns only a fixed failure code for malformed SQLite and does not expose private exception details", async () => {
    writeFileSync(sourceDatabase, "private malformed synthetic database content");
    const result = await createSnapshot(input);
    expect(result).toEqual({ ok: false, code: "source_malformed" });
    const body = JSON.stringify(result);
    expect(body).not.toContain(sourceHome);
    expect(body).not.toContain("private malformed");
    noWorkerFiles();
  });

  it("the standalone CLI accepts one bounded private JSON line and returns only its fixed result", async () => {
    const result = await runStandalone(Buffer.from(`${JSON.stringify(input)}\n`));
    expect(result).toEqual({ stdout: '{"ok":true}\n', stderr: "", code: 0 });
    expect(rows()[0]).toMatchObject({ rollout_path: input.placeholder });
  });

  it.each([Buffer.from("x".repeat(4097)), Buffer.from([0xff, 10]), Buffer.from("{}\n{}\n")])(
    "the standalone CLI rejects oversized, invalid-UTF8, or multiple input without private stderr",
    async (request) => {
      expect(await runStandalone(request)).toEqual({
        stdout: '{"ok":false,"code":"source_malformed"}\n',
        stderr: "",
        code: 0,
      });
      noWorkerFiles();
    },
  );

  it("the standalone CLI fails closed on parent EOF before a complete request", async () => {
    expect(await runStandalone(Buffer.from("{"), true)).toEqual({
      stdout: '{"ok":false,"code":"source_malformed"}\n',
      stderr: "",
      code: 0,
    });
    noWorkerFiles();
  });
});
