// @vitest-environment node
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createOwnedTemp } from "@/server/codex/owned-temp.mjs";
import { exchangeAppServer } from "@/server/codex/protocol.mjs";
import { createStateSnapshot, verifyCopiedTask } from "@/server/codex/state-snapshot.mjs";

const fake = fileURLToPath(new URL("../helpers/codex-fake.mjs", import.meta.url));
const sampleGroup = async () => ({ rssKiB: 1, members: 1 });

describe("composed private read cleanup", () => {
  it.each([
    "success",
    "wrong-id",
    "server-request",
    "invalid-json",
    "invalid-utf8",
    "remote-error",
    "truncated-line",
    "early-exit",
    "oversize-line",
    "stderr-overflow",
    "eof-hang",
    "descendant-hang",
  ])("leaves no operation home after %s", async (mode) => {
    const owner = createOwnedTemp();
    let cleaned = false;
    try {
      mkdirSync(path.join(owner.directory, "tmp"), { mode: 0o700 });
      writeFileSync(path.join(owner.directory, "fixture-mode.json"), JSON.stringify({ mode }), {
        mode: 0o600,
      });
      await exchangeAppServer({
        command: process.execPath,
        argvPrefix: [fake],
        home: owner.directory,
        owner,
        kind: "list",
        sampleGroup,
      }).catch((error) => {
        expect(error.message).toBe(error.code);
        expect(["protocol_violation", "source_unavailable", "resource_limit"]).toContain(
          error.code,
        );
      });
    } finally {
      cleaned = owner.cleanup();
    }
    expect(cleaned).toBe(true);
    expect(existsSync(owner.directory)).toBe(false);
  });
  it("leaves no operation home after an aborted call", async () => {
    const owner = createOwnedTemp();
    const signal = new AbortController();
    signal.abort();
    try {
      await expect(
        exchangeAppServer({
          command: process.execPath,
          argvPrefix: [fake],
          home: owner.directory,
          owner,
          kind: "list",
          signal: signal.signal,
          sampleGroup,
        }),
      ).rejects.toMatchObject({ code: "aborted" });
    } finally {
      expect(owner.cleanup()).toBe(true);
    }
    expect(existsSync(owner.directory)).toBe(false);
  });
  it("preserves the worker's safe missing-source code and removes its operation home", async () => {
    const owner = createOwnedTemp();
    try {
      mkdirSync(path.join(owner.directory, "tmp"), { mode: 0o700 });
      await expect(
        createStateSnapshot({
          sourceDatabase: path.join(owner.directory, "missing", "state_5.sqlite"),
          owner,
          sampleGroup,
        }),
      ).rejects.toMatchObject({ code: "missing_source", message: "missing_source" });
    } finally {
      expect(owner.cleanup()).toBe(true);
    }
    expect(existsSync(owner.directory)).toBe(false);
  });
  it("kills an active copied-row verifier when its request is cancelled", async () => {
    const owner = createOwnedTemp();
    const databasePath = path.join(owner.directory, "state_5.sqlite");
    const rollout = path.join(owner.directory, "selected.jsonl");
    const taskId = "11111111-1111-4111-8111-000000000001";
    let blocker: Database.Database | undefined;
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    try {
      mkdirSync(path.join(owner.directory, "tmp"), { mode: 0o700 });
      writeFileSync(rollout, "{}\n", { mode: 0o600 });
      const setup = new Database(databasePath);
      setup.exec("CREATE TABLE threads (id TEXT, rollout_path TEXT)");
      setup.prepare("INSERT INTO threads VALUES (?, ?)").run(taskId, rollout);
      setup.close();
      chmodSync(databasePath, 0o600);
      blocker = new Database(databasePath);
      blocker.exec("BEGIN EXCLUSIVE");
      const signal = new AbortController();
      const checking = verifyCopiedTask({
        database: databasePath,
        rollout,
        taskId,
        owner: {
          ...owner,
          recordProcess(record) {
            owner.recordProcess(record);
            markStarted();
          },
        },
        signal: signal.signal,
        sampleGroup,
      });
      await started;
      signal.abort();
      await expect(checking).rejects.toMatchObject({ code: "aborted", message: "aborted" });
    } finally {
      blocker?.close();
      expect(owner.cleanup()).toBe(true);
    }
    expect(existsSync(owner.directory)).toBe(false);
  });
});
