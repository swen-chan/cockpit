// @vitest-environment node

import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  copyStableRollout,
  type StableRolloutCopyOptions,
} from "../../src/server/codex/stable-copy.mjs";

describe("stable synthetic rollout copy", () => {
  let root: string;
  let sessions: string;
  let source: string;
  let destination: string;
  let options: StableRolloutCopyOptions;
  const content = '{"type":"synthetic","text":"safe"}\n'.repeat(4096);

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "cockpit-codex-copy-")));
    sessions = path.join(root, "sessions");
    const output = path.join(root, "output");
    mkdirSync(sessions, { mode: 0o700 });
    mkdirSync(output, { mode: 0o700 });
    source = path.join(sessions, "rollout.jsonl");
    destination = path.join(output, "copied.jsonl");
    writeFileSync(source, content, { mode: 0o600 });
    options = { source, destination, allowedRoots: [sessions] };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  const fingerprint = (filename: string) => {
    const stat = statSync(filename, { bigint: true });
    return {
      hash: createHash("sha256").update(readFileSync(filename)).digest("hex"),
      dev: stat.dev,
      ino: stat.ino,
      size: stat.size,
      mtimeNs: stat.mtimeNs,
    };
  };

  async function rejectsSafely(copyOptions: StableRolloutCopyOptions, code: string) {
    const error = await copyStableRollout(copyOptions).catch((caught: unknown) => caught);
    expect(error).toEqual({ code });
    expect(Object.keys(error as object)).toEqual(["code"]);
    expect(error).not.toBeInstanceOf(Error);
    expect(JSON.stringify(error)).not.toContain(root);
    expect(existsSync(destination)).toBe(false);
  }

  it("copies exact stable bytes privately without changing the source", async () => {
    const before = fingerprint(source);
    expect(await copyStableRollout(options)).toEqual({
      bytesCopied: Buffer.byteLength(content),
      attempts: 1,
    });
    expect(readFileSync(destination, "utf8")).toBe(content);
    expect(statSync(destination).mode & 0o777).toBe(0o600);
    expect(fingerprint(source)).toEqual(before);
  });

  it("supports an empty rollout and the archived source root", async () => {
    const archived = path.join(root, "archived_sessions");
    mkdirSync(archived, { mode: 0o700 });
    source = path.join(archived, "empty.jsonl");
    writeFileSync(source, "", { mode: 0o600 });
    expect(
      await copyStableRollout({ ...options, source, allowedRoots: [sessions, archived] }),
    ).toEqual({ bytesCopied: 0, attempts: 1 });
    expect(readFileSync(destination)).toHaveLength(0);
  });

  it("restarts once after an append, discarding the first output", async () => {
    const seen = new Set<number>();
    let appended = false;
    const result = await copyStableRollout({
      ...options,
      onChunk: ({ attempt }) => {
        seen.add(attempt);
        if (!appended) {
          appended = true;
          appendFileSync(source, '{"type":"appended"}\n');
        }
      },
    });
    expect(result.attempts).toBe(2);
    expect([...seen]).toEqual([1, 2]);
    expect(readFileSync(destination)).toEqual(readFileSync(source));
  });

  it("fails after a second append without leaving mixed output", async () => {
    const seen = new Set<number>();
    await rejectsSafely(
      {
        ...options,
        onChunk: ({ attempt }) => {
          if (!seen.has(attempt)) {
            seen.add(attempt);
            appendFileSync(source, '{"type":"appended"}\n');
          }
        },
      },
      "source_busy",
    );
    expect([...seen]).toEqual([1, 2]);
  });

  it("detects pathname replacement even while the opened descriptor stays stable", async () => {
    let replaced = false;
    const replacement = '{"type":"replacement"}\n';
    expect(
      (
        await copyStableRollout({
          ...options,
          onChunk: () => {
            if (!replaced) {
              replaced = true;
              renameSync(source, path.join(sessions, "original.jsonl"));
              writeFileSync(source, replacement, { mode: 0o600 });
            }
          },
        })
      ).attempts,
    ).toBe(2);
    expect(readFileSync(destination, "utf8")).toBe(replacement);
  });

  it("fails after a second pathname replacement", async () => {
    const seen = new Set<number>();
    await rejectsSafely(
      {
        ...options,
        onChunk: ({ attempt }) => {
          if (!seen.has(attempt)) {
            seen.add(attempt);
            renameSync(source, path.join(sessions, `original-${attempt}.jsonl`));
            writeFileSync(source, content, { mode: 0o600 });
          }
        },
      },
      "source_busy",
    );
    expect([...seen]).toEqual([1, 2]);
  });

  it("fails immediately after shrink/short read instead of restarting", async () => {
    const seen = new Set<number>();
    await rejectsSafely(
      {
        ...options,
        onChunk: ({ attempt }) => {
          seen.add(attempt);
          truncateSync(source, 5);
        },
      },
      "source_busy",
    );
    expect([...seen]).toEqual([1]);
  });

  it("rejects source-file and in-root directory symlinks", async () => {
    const link = path.join(sessions, "link.jsonl");
    symlinkSync(source, link);
    await rejectsSafely({ ...options, source: link }, "source_unavailable");
    const actual = path.join(sessions, "actual");
    mkdirSync(actual);
    writeFileSync(path.join(actual, "nested.jsonl"), content);
    const directoryLink = path.join(sessions, "linked");
    symlinkSync(actual, directoryLink);
    await rejectsSafely(
      { ...options, source: path.join(directoryLink, "nested.jsonl") },
      "source_unavailable",
    );
  });

  it("rejects an out-of-root rollout", async () => {
    const outside = path.join(root, "outside.jsonl");
    writeFileSync(outside, content);
    await rejectsSafely({ ...options, source: outside }, "source_unavailable");
  });

  it("rejects a non-regular source before reading", async () => {
    rmSync(source);
    mkdirSync(source);
    await rejectsSafely(options, "source_unavailable");
  });

  it("rejects an oversized sparse rollout before copying its bytes", async () => {
    truncateSync(source, 32 * 1024 * 1024 + 1);
    await rejectsSafely(options, "source_too_large");
  });

  it("returns a fixed missing-source code", async () => {
    rmSync(source);
    await rejectsSafely(options, "missing_source");
  });

  it("rejects malformed calls with a code-only failure", async () => {
    for (const candidate of [undefined, null, [], { ...options, source: "relative.jsonl" }]) {
      await rejectsSafely(candidate as unknown as StableRolloutCopyOptions, "source_malformed");
    }
  });

  it("rejects a source tree not owned by the effective UID", async () => {
    const uid = process.geteuid?.();
    if (uid === undefined) throw new Error("Synthetic Codex copier requires Unix.");
    vi.spyOn(process, "geteuid").mockReturnValue(uid + 1);
    await rejectsSafely(options, "source_unavailable");
  });

  it("cooperatively aborts before and during copying without echoing the reason", async () => {
    const early = new AbortController();
    early.abort(new Error(`private abort reason ${source}`));
    await rejectsSafely({ ...options, signal: early.signal }, "source_busy");
    const during = new AbortController();
    await rejectsSafely(
      {
        ...options,
        signal: during.signal,
        onChunk: () => {
          during.abort(new Error(`private abort reason ${source}`));
        },
      },
      "source_busy",
    );
  });

  it("cooperatively checks the deadline before and after chunks", async () => {
    await rejectsSafely({ ...options, deadline: Date.now() - 1 }, "source_busy");
    const deadline = Date.now() + 60_000;
    await rejectsSafely(
      {
        ...options,
        deadline,
        onChunk: () => {
          vi.spyOn(Date, "now").mockReturnValue(deadline + 1);
        },
      },
      "source_busy",
    );
  });

  it("replaces a raw callback error with a code-only failure", async () => {
    await rejectsSafely(
      {
        ...options,
        onChunk: () => {
          throw new Error(`private test callback ${source}`);
        },
      },
      "source_unavailable",
    );
  });

  it("does not overwrite or remove a pre-existing destination", async () => {
    writeFileSync(destination, "existing private file", { mode: 0o600 });
    await expect(copyStableRollout(options)).rejects.toEqual({ code: "source_unavailable" });
    expect(readFileSync(destination, "utf8")).toBe("existing private file");
  });

  it("never writes through a destination symlink to the source", async () => {
    const before = fingerprint(source);
    symlinkSync(source, destination);
    await expect(copyStableRollout(options)).rejects.toEqual({ code: "source_unavailable" });
    expect(fingerprint(source)).toEqual(before);
    expect(existsSync(destination)).toBe(true);
  });

  it("does not delete a foreign replacement of its destination during failure cleanup", async () => {
    let replaced = false;
    await expect(
      copyStableRollout({
        ...options,
        onChunk: () => {
          if (!replaced) {
            replaced = true;
            renameSync(destination, path.join(root, "original-output.jsonl"));
            writeFileSync(destination, "foreign private replacement", { mode: 0o600 });
          }
        },
      }),
    ).rejects.toEqual({ code: "source_busy" });
    expect(readFileSync(destination, "utf8")).toBe("foreign private replacement");
  });

  it("does not create output inside the approved source tree", async () => {
    const nestedDestination = path.join(sessions, "copied.jsonl");
    await rejectsSafely({ ...options, destination: nestedDestination }, "source_unavailable");
    expect(existsSync(nestedDestination)).toBe(false);
  });

  it("loops until all bytes are written when writes are partial", async () => {
    const probe = await open(source, "r");
    const prototype = Object.getPrototypeOf(probe) as Pick<FileHandle, "write">;
    type BufferedWrite = (
      buffer: Uint8Array,
      offset: number,
      length: number,
      position: number,
    ) => Promise<{
      bytesWritten: number;
      buffer: Uint8Array;
    }>;
    const original = prototype.write as unknown as BufferedWrite;
    await probe.close();
    let calls = 0;
    vi.spyOn(prototype, "write").mockImplementation(function (
      this: FileHandle,
      buffer: Uint8Array,
      offset: number,
      length: number,
      position: number,
    ) {
      calls += 1;
      return original.call(this, buffer, offset, Math.min(length, 127), position);
    } as FileHandle["write"]);
    await copyStableRollout(options);
    expect(calls).toBeGreaterThan(2);
    expect(readFileSync(destination, "utf8")).toBe(content);
  });

  it("fails on a short read even if the source itself stayed unchanged", async () => {
    const before = fingerprint(source);
    const probe = await open(source, "r");
    const prototype = Object.getPrototypeOf(probe) as Pick<FileHandle, "read">;
    type BufferedRead = (
      buffer: Uint8Array,
      offset: number,
      length: number,
      position: number,
    ) => Promise<{
      bytesRead: number;
      buffer: Uint8Array;
    }>;
    const original = prototype.read as unknown as BufferedRead;
    await probe.close();
    vi.spyOn(prototype, "read").mockImplementation(function (
      this: FileHandle,
      buffer: Uint8Array,
      offset: number,
      length: number,
      position: number,
    ) {
      return original.call(this, buffer, offset, length - 1, position);
    } as FileHandle["read"]);
    await rejectsSafely(options, "source_busy");
    expect(fingerprint(source)).toEqual(before);
  });
});
