// @vitest-environment node
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertOwnedTempDirectory,
  createOwnedTemp,
  reapOwnedTemps,
  type OwnedProcess,
  type OwnedTemp,
} from "@/server/codex/owned-temp.mjs";

const HOUR = 3_600_000;
const child: OwnedProcess = {
  pid: 2_000_001,
  pgid: 2_000_001,
  executableIdentity: "1:2:3",
  startToken: "synthetic-spawn-1",
};

function gone() {
  return Object.assign(new Error("synthetic missing process"), { code: "ESRCH" });
}

describe("Codex private operation ownership", () => {
  let fixture: string;
  let parent: string;
  let now: number;

  beforeEach(() => {
    fixture = realpathSync(
      mkdtempSync(path.join(realpathSync("/tmp"), "cockpit-owned-temp-test-")),
    );
    chmodSync(fixture, 0o700);
    parent = path.join(fixture, "parent");
    now = Date.now() + 10_000;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(fixture, { recursive: true, force: true });
  });

  function makeOld(owned: OwnedTemp, age = HOUR + 1) {
    const marker = JSON.parse(readFileSync(owned.markerPath, "utf8")) as Record<string, unknown>;
    marker.createdAt = now - age;
    writeFileSync(owned.markerPath, JSON.stringify(marker));
    utimesSync(owned.directory, (now - age) / 1_000, (now - age) / 1_000);
  }

  it("creates only a direct private directory and constant-version private marker", () => {
    const owned = createOwnedTemp({ parent });
    expect(path.dirname(owned.directory)).toBe(parent);
    expect(path.basename(owned.directory)).toMatch(/^operation-[A-Za-z0-9]{6}$/);
    expect(path.basename(owned.markerPath)).toBe(".cockpit-owner.json");
    expect(lstatSync(parent).mode & 0o7777).toBe(0o700);
    expect(lstatSync(owned.directory).mode & 0o7777).toBe(0o700);
    expect(lstatSync(owned.markerPath).mode & 0o7777).toBe(0o600);
    expect(JSON.parse(readFileSync(owned.markerPath, "utf8"))).toMatchObject({
      owner: "cockpit-codex",
      version: 1,
      uid: process.geteuid!(),
      processes: [],
    });
    expect(owned.cleanup()).toBe(true);
    expect(owned.cleanup()).toBe(true);
    expect(existsSync(owned.directory)).toBe(false);
    expect(existsSync(parent)).toBe(true);
  });

  it("lets the child validate its own recorded PID without permitting host self-registration", () => {
    const owned = createOwnedTemp({ parent });
    expect(() => assertOwnedTempDirectory(owned.directory)).not.toThrow();
    const marker = JSON.parse(readFileSync(owned.markerPath, "utf8")) as Record<string, unknown>;
    marker.processes = [{ ...child, pid: process.pid, pgid: process.pid }];
    writeFileSync(owned.markerPath, JSON.stringify(marker));
    expect(() => assertOwnedTempDirectory(owned.directory)).not.toThrow();
    const malformed = createOwnedTemp({ parent });
    writeFileSync(malformed.markerPath, "{}");
    expect(() => assertOwnedTempDirectory(malformed.directory)).toThrow(
      "Invalid Cockpit temporary ownership",
    );
    expect(() => assertOwnedTempDirectory(parent)).toThrow("Invalid Cockpit temporary ownership");
  });

  it("records exact bounded process identities and cleans only after both PID and group are gone", () => {
    const owned = createOwnedTemp({ parent });
    owned.recordProcess(child);
    owned.recordProcess({ ...child, pid: child.pid + 1, pgid: child.pid + 1 });
    expect(JSON.parse(readFileSync(owned.markerPath, "utf8")).processes).toEqual([
      child,
      { ...child, pid: child.pid + 1, pgid: child.pid + 1 },
    ]);
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      throw gone();
    });
    expect(owned.cleanup()).toBe(true);
    expect(kill.mock.calls).toEqual([
      [child.pid, 0],
      [-child.pgid, 0],
      [child.pid + 1, 0],
      [-child.pgid - 1, 0],
    ]);
  });

  it.each([
    { ...child, pid: 1, pgid: 1 },
    { ...child, pid: process.pid, pgid: process.pid },
    { ...child, pgid: child.pid + 1 },
    { ...child, pid: -2, pgid: -2 },
    { ...child, executableIdentity: "/synthetic/private/executable" },
    { ...child, executableIdentity: "1:2:3\n" },
    { ...child, startToken: "" },
    { ...child, startToken: "x".repeat(257) },
    { ...child, markerPath: "/synthetic/private/foreign" },
  ])("rejects invalid process records without changing the marker", (record) => {
    const owned = createOwnedTemp({ parent });
    const before = readFileSync(owned.markerPath, "utf8");
    expect(() => owned.recordProcess(record)).toThrow("Invalid Cockpit temporary ownership");
    expect(readFileSync(owned.markerPath, "utf8")).toBe(before);
    expect(owned.cleanup()).toBe(true);
  });

  it("rejects duplicate process records", () => {
    const owned = createOwnedTemp({ parent });
    owned.recordProcess(child);
    expect(() => owned.recordProcess(child)).toThrow("Invalid Cockpit temporary ownership");
  });

  it("preserves a directory for a live PID without sending a terminating signal", () => {
    const owned = createOwnedTemp({ parent });
    owned.recordProcess(child);
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    expect(owned.cleanup()).toBe(false);
    expect(existsSync(owned.directory)).toBe(true);
    expect(kill.mock.calls).toEqual([[child.pid, 0]]);
  });

  it("preserves a live group after its original leader exits, then permits cleanup when it exits", () => {
    const owned = createOwnedTemp({ parent });
    owned.recordProcess(child);
    const kill = vi.spyOn(process, "kill").mockImplementation((pid) => {
      if (pid === child.pid) throw gone();
      return true;
    });
    expect(owned.cleanup()).toBe(false);
    expect(kill.mock.calls).toEqual([
      [child.pid, 0],
      [-child.pgid, 0],
    ]);
    kill.mockImplementation(() => {
      throw gone();
    });
    expect(owned.cleanup()).toBe(true);
  });

  it("preserves ambiguous default liveness such as EPERM", () => {
    const owned = createOwnedTemp({ parent });
    owned.recordProcess(child);
    vi.spyOn(process, "kill").mockImplementation((pid) => {
      if (pid === child.pid) throw Object.assign(new Error("synthetic denied"), { code: "EPERM" });
      throw gone();
    });
    expect(owned.cleanup()).toBe(false);
    expect(existsSync(owned.directory)).toBe(true);
  });

  it("refuses parents outside the canonical temporary root or with permissive modes", () => {
    expect(() => createOwnedTemp({ parent: "/Users" })).toThrow(
      "Invalid Cockpit temporary ownership",
    );
    mkdirSync(parent, { mode: 0o755 });
    expect(() => createOwnedTemp({ parent })).toThrow("Invalid Cockpit temporary ownership");
    expect(reapOwnedTemps({ parent, now })).toEqual({ examined: 0, removed: 0 });
  });

  it("never creates or follows a parent reached through a symlink", () => {
    const target = path.join(fixture, "target");
    mkdirSync(target, { mode: 0o700 });
    symlinkSync(target, parent);
    expect(() => createOwnedTemp({ parent })).toThrow("Invalid Cockpit temporary ownership");
    expect(() => createOwnedTemp({ parent: path.join(parent, "nested") })).toThrow(
      "Invalid Cockpit temporary ownership",
    );
    expect(existsSync(path.join(target, "nested"))).toBe(false);
    expect(reapOwnedTemps({ parent, now })).toEqual({ examined: 0, removed: 0 });
  });

  it("refuses a replaced operation directory, even when the replacement has a copied marker", () => {
    const owned = createOwnedTemp({ parent });
    const bytes = readFileSync(owned.markerPath, "utf8");
    renameSync(owned.directory, path.join(fixture, "original"));
    mkdirSync(owned.directory, { mode: 0o700 });
    writeFileSync(owned.markerPath, bytes, { mode: 0o600 });
    expect(owned.cleanup()).toBe(false);
    expect(existsSync(owned.directory)).toBe(true);
    expect(existsSync(path.join(fixture, "original"))).toBe(true);
  });

  it("refuses marker mutation, marker symlinks, and marker hard links", () => {
    const mutated = createOwnedTemp({ parent });
    writeFileSync(mutated.markerPath, "{}");
    expect(mutated.cleanup()).toBe(false);
    const linked = createOwnedTemp({ parent });
    renameSync(linked.markerPath, path.join(fixture, "marker-target"));
    symlinkSync(path.join(fixture, "marker-target"), linked.markerPath);
    expect(linked.cleanup()).toBe(false);
    const hardLinked = createOwnedTemp({ parent });
    linkSync(hardLinked.markerPath, path.join(fixture, "hard-marker"));
    expect(hardLinked.cleanup()).toBe(false);
  });

  it("removes interior symlinks themselves but leaves their targets untouched", () => {
    const owned = createOwnedTemp({ parent });
    const target = path.join(fixture, "outside-operation");
    mkdirSync(target, { mode: 0o700 });
    writeFileSync(path.join(target, "safe.txt"), "synthetic");
    symlinkSync(target, path.join(owned.directory, "link"));
    expect(owned.cleanup()).toBe(true);
    expect(readFileSync(path.join(target, "safe.txt"), "utf8")).toBe("synthetic");
  });

  it("reaps only directories strictly older than one hour by both marker and directory age", () => {
    const old = createOwnedTemp({ parent });
    const exact = createOwnedTemp({ parent });
    const freshMarker = createOwnedTemp({ parent });
    const freshDirectory = createOwnedTemp({ parent });
    makeOld(old);
    makeOld(exact, HOUR);
    utimesSync(freshMarker.directory, (now - 2 * HOUR) / 1_000, (now - 2 * HOUR) / 1_000);
    makeOld(freshDirectory);
    utimesSync(freshDirectory.directory, now / 1_000, now / 1_000);
    expect(reapOwnedTemps({ parent, now })).toEqual({ examined: 4, removed: 1 });
    expect(existsSync(old.directory)).toBe(false);
    for (const owned of [exact, freshMarker, freshDirectory])
      expect(existsSync(owned.directory)).toBe(true);
  });

  it.each([true, undefined, "throw"])(
    "preserves live or ambiguous stale records (%s)",
    (liveness) => {
      const owned = createOwnedTemp({ parent });
      owned.recordProcess(child);
      makeOld(owned);
      const kill = vi.spyOn(process, "kill");
      const isLive = vi.fn(() => {
        if (liveness === "throw") throw new Error("synthetic unavailable");
        return liveness === true ? true : undefined;
      });
      expect(reapOwnedTemps({ parent, now, isLive })).toEqual({ examined: 1, removed: 0 });
      expect(isLive).toHaveBeenCalledWith(child);
      expect(kill).not.toHaveBeenCalled();
      expect(existsSync(owned.directory)).toBe(true);
    },
  );

  it("reaps stale records only on an explicit gone result", () => {
    const owned = createOwnedTemp({ parent });
    owned.recordProcess(child);
    makeOld(owned);
    expect(reapOwnedTemps({ parent, now, isLive: () => false })).toEqual({
      examined: 1,
      removed: 1,
    });
  });

  it("rejects the liveness injection outside unit tests", () => {
    const owned = createOwnedTemp({ parent });
    makeOld(owned);
    vi.stubEnv("NODE_ENV", "production");
    expect(() => reapOwnedTemps({ parent, now, isLive: () => false })).toThrow(
      "Invalid Cockpit temporary ownership",
    );
    expect(existsSync(owned.directory)).toBe(true);
  });

  it.each(["extra-path", "wrong-uid", "wrong-version", "oversized", "malformed", "unsafe-mode"])(
    "leaves invalid stale markers untouched (%s)",
    (kind) => {
      const owned = createOwnedTemp({ parent });
      makeOld(owned);
      const marker = JSON.parse(readFileSync(owned.markerPath, "utf8")) as Record<string, unknown>;
      if (kind === "extra-path") marker.directory = fixture;
      if (kind === "wrong-uid") marker.uid = process.geteuid!() + 1;
      if (kind === "wrong-version") marker.version = 2;
      writeFileSync(
        owned.markerPath,
        kind === "oversized"
          ? "x".repeat(16_385)
          : kind === "malformed"
            ? "{"
            : JSON.stringify(marker),
      );
      if (kind === "unsafe-mode") chmodSync(owned.markerPath, 0o644);
      expect(reapOwnedTemps({ parent, now, isLive: () => false })).toEqual({
        examined: 1,
        removed: 0,
      });
      expect(existsSync(owned.directory)).toBe(true);
    },
  );

  it("bounds examined direct entries rather than enumerating or recursing through all children", () => {
    for (let index = 0; index < 5; index += 1) makeOld(createOwnedTemp({ parent }));
    expect(reapOwnedTemps({ parent, now, maxEntries: 2 })).toEqual({ examined: 2, removed: 2 });
    expect(reapOwnedTemps({ parent, now, maxEntries: 0 })).toEqual({ examined: 0, removed: 0 });
    expect(() => reapOwnedTemps({ parent, now, maxEntries: 33 })).toThrow(
      "Invalid Cockpit temporary ownership",
    );
  });

  it("ignores direct child symlinks and never scans nested operation directories", () => {
    const targetParent = path.join(fixture, "target-parent");
    const target = createOwnedTemp({ parent: targetParent });
    makeOld(target);
    mkdirSync(parent, { mode: 0o700 });
    symlinkSync(target.directory, path.join(parent, "operation-ABC123"));
    const nestedParent = path.join(parent, "nested");
    const nested = createOwnedTemp({ parent: nestedParent });
    makeOld(nested);
    expect(reapOwnedTemps({ parent, now, isLive: () => false })).toEqual({
      examined: 2,
      removed: 0,
    });
    expect(existsSync(target.directory)).toBe(true);
    expect(existsSync(nested.directory)).toBe(true);
  });

  it("rechecks identity after a liveness callback changes the marker", () => {
    const owned = createOwnedTemp({ parent });
    owned.recordProcess(child);
    makeOld(owned);
    expect(
      reapOwnedTemps({
        parent,
        now,
        isLive: () => {
          writeFileSync(owned.markerPath, "{}");
          return false;
        },
      }),
    ).toEqual({ examined: 1, removed: 0 });
    expect(existsSync(owned.directory)).toBe(true);
  });
});
