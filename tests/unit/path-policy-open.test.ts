// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fsObservation = vi.hoisted(() => ({
  openFlags: [] as number[],
  openedDescriptors: [] as number[],
  spoofLstatIdentity: false,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    openSync(filePath: import("node:fs").PathLike, flags: number, mode?: number) {
      const descriptor =
        mode === undefined
          ? actual.openSync(filePath, flags)
          : actual.openSync(filePath, flags, mode);
      fsObservation.openFlags.push(flags);
      fsObservation.openedDescriptors.push(descriptor);
      return descriptor;
    },
    lstatSync(filePath: import("node:fs").PathLike) {
      const stats = actual.lstatSync(filePath);
      if (!fsObservation.spoofLstatIdentity || !stats.isFile()) return stats;
      return new Proxy(stats, {
        get(target, property) {
          if (property === "ino") return target.ino + 1;
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
});

import {
  resolveApprovedWorkspacePath,
  withExistingWorkspaceFile,
} from "@/server/security/path-policy";

describe("workspace file descriptor opening policy", () => {
  let fixtureRoot = "";
  let workspaceRoot = "";
  let source = "";

  beforeEach(() => {
    fsObservation.openFlags.length = 0;
    fsObservation.openedDescriptors.length = 0;
    fsObservation.spoofLstatIdentity = false;
    fixtureRoot = mkdtempSync(path.join(tmpdir(), "cockpit-path-open-"));
    workspaceRoot = path.join(fixtureRoot, "workspace");
    mkdirSync(workspaceRoot);
    source = path.join(workspaceRoot, "source.md");
    writeFileSync(source, "safe fixture");
  });

  afterEach(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  it("sets O_NONBLOCK on a regular-file descriptor", async () => {
    await expect(withExistingWorkspaceFile(workspaceRoot, "source.md", () => "read")).resolves.toBe(
      "read",
    );

    expect(fsObservation.openFlags).toHaveLength(1);
    expect(fsObservation.openFlags[0]! & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK);
  });

  it("rejects a special file during lstat preflight without opening it", async () => {
    const fifo = path.join(workspaceRoot, "source.fifo");
    execFileSync("mkfifo", [fifo]);
    const anchor = openSync(fifo, constants.O_RDWR | constants.O_NONBLOCK);
    fsObservation.openFlags.length = 0;
    fsObservation.openedDescriptors.length = 0;

    try {
      await expect(
        withExistingWorkspaceFile(workspaceRoot, "source.fifo", () => "read"),
      ).rejects.toMatchObject({ code: "source_unavailable" });
      expect(fsObservation.openFlags).toEqual([]);
    } finally {
      closeSync(anchor);
    }
  });

  it("rejects an lstat-to-open identity change before calling the reader and closes the descriptor", async () => {
    fsObservation.spoofLstatIdentity = true;
    const reader = vi.fn(() => "read");

    await expect(
      withExistingWorkspaceFile(workspaceRoot, "source.md", reader),
    ).rejects.toMatchObject({ code: "source_unavailable" });

    expect(reader).not.toHaveBeenCalled();
    const descriptor = fsObservation.openedDescriptors.at(-1);
    expect(descriptor).toBeTypeOf("number");
    expect(() => fstatSync(descriptor!)).toThrowError(expect.objectContaining({ code: "EBADF" }));
  });

  it("applies the same nonblocking identity guard in the protocol path resolver", () => {
    fsObservation.spoofLstatIdentity = true;

    expect(() =>
      resolveApprovedWorkspacePath(workspaceRoot, source, { kind: "file" }),
    ).toThrowError(expect.objectContaining({ code: "source_unavailable" }));

    expect(fsObservation.openFlags).toHaveLength(1);
    expect(fsObservation.openFlags[0]! & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK);
    const descriptor = fsObservation.openedDescriptors.at(-1);
    expect(descriptor).toBeTypeOf("number");
    expect(() => fstatSync(descriptor!)).toThrowError(expect.objectContaining({ code: "EBADF" }));
  });
});
