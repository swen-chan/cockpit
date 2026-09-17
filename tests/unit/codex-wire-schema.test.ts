// @vitest-environment node
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { release, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromJSONSchema } from "zod";

import { exchangeAppServer } from "../../src/server/codex/protocol.mjs";

const fixtureDirectory = fileURLToPath(new URL("../fixtures/codex-0.145.0/", import.meta.url));
const fakePath = fileURLToPath(new URL("../helpers/codex-fake.mjs", import.meta.url));
const names = [
  "InitializeParams",
  "InitializeResponse",
  "ThreadListParams",
  "ThreadListResponse",
  "ThreadReadParams",
  "ThreadReadResponse",
] as const;
type SchemaName = (typeof names)[number];
type JsonObject = Record<string, unknown>;

const provenance = JSON.parse(
  readFileSync(path.join(fixtureDirectory, "provenance.json"), "utf8"),
) as {
  cliVersion: string;
  artifacts: Record<string, { sha256: string }>;
};

function rawSchema(name: SchemaName): JsonObject {
  return JSON.parse(
    readFileSync(path.join(fixtureDirectory, `${name}.json`), "utf8"),
  ) as JsonObject;
}

const parsers = Object.fromEntries(
  names.map((name) => [
    name,
    fromJSONSchema(rawSchema(name) as Parameters<typeof fromJSONSchema>[0]),
  ]),
) as Record<SchemaName, ReturnType<typeof fromJSONSchema>>;

function assertLocalReferences(schema: JsonObject) {
  function visit(value: unknown) {
    if (value === null || typeof value !== "object") return;
    if (!Array.isArray(value) && "$ref" in value) {
      const reference = (value as JsonObject).$ref;
      expect(typeof reference).toBe("string");
      expect(reference).toMatch(/^#\//);
      let resolved: unknown = schema;
      for (const segment of (reference as string).slice(2).split("/")) {
        const key = decodeURIComponent(segment).replaceAll("~1", "/").replaceAll("~0", "~");
        expect(resolved !== null && typeof resolved === "object").toBe(true);
        resolved = (resolved as JsonObject)[key];
        expect(resolved).not.toBeUndefined();
      }
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(schema);
}

describe("Codex 0.145.0 generated wire schema contract", () => {
  let home: string;
  let groups: number[];

  beforeEach(() => {
    home = realpathSync(mkdtempSync(path.join(tmpdir(), "cockpit-wire-fixture-")));
    chmodSync(home, 0o700);
    mkdirSync(path.join(home, "tmp"), { mode: 0o700 });
    groups = [];
  });

  afterEach(() => {
    for (const pgid of groups) {
      try {
        process.kill(-pgid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
    rmSync(home, { recursive: true, force: true });
  });

  it.each(names)("retains the unchanged, self-contained %s schema", (name) => {
    const filename = `${name}.json`;
    const bytes = readFileSync(path.join(fixtureDirectory, filename));
    expect(provenance.cliVersion).toBe("codex-cli 0.145.0");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      provenance.artifacts[filename]?.sha256,
    );
    expect(rawSchema(name).$schema).toBe("http://json-schema.org/draft-07/schema#");
    assertLocalReferences(rawSchema(name));
  });

  it.each(["LICENSE", "NOTICE"])(
    "retains the exact upstream %s attribution artifact",
    (filename) => {
      const bytes = readFileSync(path.join(fixtureDirectory, filename));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        provenance.artifacts[filename]?.sha256,
      );
    },
  );

  it("validates the actual bounded fake list/read exchanges against all six schemas", async () => {
    const mac = process.platform === "darwin";
    const initializeResult = {
      codexHome: home,
      platformFamily: "unix",
      platformOs: mac ? "macos" : "linux",
      userAgent: `cockpit/0.145.0 (${mac ? "Mac OS" : "Linux"} ${release()}; ${process.arch}) dumb (cockpit; 0.2.0)`,
    };
    expect(parsers.InitializeResponse.safeParse(initializeResult).success).toBe(true);
    writeFileSync(
      path.join(home, "fixture-mode.json"),
      JSON.stringify({
        mode: "success",
        recordRequests: true,
        initializeResult,
      }),
      { mode: 0o600 },
    );
    const options = {
      command: process.execPath,
      argvPrefix: [fakePath],
      home,
      owner: {
        recordProcess(record: { pgid: number }) {
          groups.push(record.pgid);
        },
      },
      // This contract test does not claim to measure OS RSS.
      sampleGroup: async () => ({ rssKiB: 1, members: 1 }),
    };
    const listReply = await exchangeAppServer({ ...options, kind: "list" });
    expect(parsers.ThreadListResponse.safeParse(listReply.result).success).toBe(true);
    const readReply = await exchangeAppServer({
      ...options,
      kind: "read",
      taskId: "synthetic-thread",
      copiedRowExists: true,
    });
    expect(parsers.ThreadReadResponse.safeParse(readReply.result).success).toBe(true);

    const observations = readFileSync(path.join(home, "fixture-observations.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { method: string; params: unknown });
    expect(observations.map((row) => row.method)).toEqual([
      "initialize",
      "initialized",
      "thread/list",
      "initialize",
      "initialized",
      "thread/read",
    ]);
    for (const row of observations.filter((row) => row.method === "initialize")) {
      expect(parsers.InitializeParams.safeParse(row.params).success).toBe(true);
    }
    expect(parsers.ThreadListParams.safeParse(observations[2]?.params).success).toBe(true);
    expect(parsers.ThreadReadParams.safeParse(observations[5]?.params).success).toBe(true);

    // Required-field omissions prove the full generated Thread/Turn contract is
    // checked, not merely the few fields today's production decoder reads.
    const readResult = readReply.result as { thread: JsonObject };
    const threadSchema = (rawSchema("ThreadReadResponse").definitions as JsonObject)
      .Thread as JsonObject;
    for (const key of threadSchema.required as string[]) {
      const incomplete = { ...readResult.thread };
      delete incomplete[key];
      expect(parsers.ThreadReadResponse.safeParse({ thread: incomplete }).success, key).toBe(false);
    }
    const turns = readResult.thread.turns as JsonObject[];
    for (const key of ["id", "items", "status"]) {
      const incomplete = { ...turns[0] };
      delete incomplete[key];
      expect(
        parsers.ThreadReadResponse.safeParse({
          thread: { ...readResult.thread, turns: [incomplete] },
        }).success,
        `turn.${key}`,
      ).toBe(false);
    }
    expect(
      parsers.ThreadReadResponse.safeParse({
        thread: { ...readResult.thread, status: { type: "active" } },
      }).success,
    ).toBe(false);
    expect(listReply.metrics.closed).toBe(true);
    expect(readReply.metrics.closed).toBe(true);
    expect(groups).toHaveLength(2);
    for (const pgid of groups) {
      expect(() => process.kill(-pgid, 0)).toThrowError(expect.objectContaining({ code: "ESRCH" }));
    }
  });

  it("rejects missing required top-level params and response fields", () => {
    expect(parsers.InitializeParams.safeParse({}).success).toBe(false);
    expect(parsers.InitializeParams.safeParse({ clientInfo: { name: "cockpit" } }).success).toBe(
      false,
    );
    expect(
      parsers.InitializeResponse.safeParse({
        userAgent: "synthetic",
        platformFamily: "unix",
        platformOs: "macos",
      }).success,
    ).toBe(false);
    expect(parsers.ThreadListResponse.safeParse({ nextCursor: null }).success).toBe(false);
    expect(parsers.ThreadReadParams.safeParse({ includeTurns: true }).success).toBe(false);
    expect(parsers.ThreadReadResponse.safeParse({}).success).toBe(false);
  });
});
