import { describe, expect, it, vi } from "vitest";

import { createPanelTokenCodec, type PanelTokenScope } from "@/server/panels/opaque-token";

const hermes = {
  panelId: "hermes",
  runtime: "hermes",
  adapterVersion: "hermes-v1",
} satisfies PanelTokenScope;
const codex = {
  panelId: "codex",
  runtime: "codex",
  adapterVersion: "codex-0.145.0",
} satisfies PanelTokenScope;

function codec(fill: number) {
  return createPanelTokenCodec(new Uint8Array(32).fill(fill));
}

describe("panel-bound opaque tokens", () => {
  it("round-trips task and maximum-size cursor values without exposing plaintext", () => {
    const tokens = codec(1);
    const rawTask = "thread-private-55555555-5555-4555-8555-555555555555";
    const rawCursor = "c".repeat(4_096);
    const first = tokens.encodeTask(codex, rawTask);
    const second = tokens.encodeTask(codex, rawTask);
    const cursor = tokens.encodeCursor(codex, rawCursor);

    expect(first).toMatch(/^task-[A-Za-z0-9_-]+$/u);
    expect(cursor).toMatch(/^cursor-[A-Za-z0-9_-]+$/u);
    expect(first).not.toBe(second);
    expect(first).not.toContain(rawTask);
    expect(tokens.decodeTask(codex, first)).toBe(rawTask);
    expect(tokens.decodeCursor(codex, cursor)).toBe(rawCursor);
  });

  it("rejects forged, truncated, malformed, and oversized values", () => {
    const tokens = codec(2);
    const task = tokens.encodeTask(codex, "raw-task");
    const replacement = task.endsWith("A") ? "B" : "A";

    for (const candidate of [
      `${task.slice(0, -1)}${replacement}`,
      task.slice(0, 24),
      "task-not+base64url",
      "raw-task",
      `task-${"a".repeat(6_000)}`,
    ]) {
      expect(() => tokens.decodeTask(codex, candidate)).toThrowError(
        expect.objectContaining({ code: "invalid_path" }),
      );
    }
    expect(tokens.decodeTask(codex, tokens.encodeTask(codex, "x".repeat(128)))).toBe(
      "x".repeat(128),
    );
    expect(() => tokens.encodeTask(codex, "x".repeat(129))).toThrowError(
      expect.objectContaining({ code: "invalid_path" }),
    );
    expect(tokens.decodeTask(hermes, tokens.encodeTask(hermes, "x".repeat(200)))).toBe(
      "x".repeat(200),
    );
    expect(() => tokens.encodeTask(hermes, "x".repeat(201))).toThrowError(
      expect.objectContaining({ code: "invalid_path" }),
    );
    expect(() => tokens.encodeCursor(codex, "😀".repeat(1_025))).toThrowError(
      expect.objectContaining({ code: "invalid_path" }),
    );

    const canonical = tokens.encodeTask(codex, "x");
    const encoded = canonical.slice("task-".length);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const finalIndex = alphabet.indexOf(encoded[encoded.length - 1] ?? "");
    expect([2, 3]).toContain(encoded.length % 4);
    expect(finalIndex).toBeGreaterThanOrEqual(0);
    const aliasEncoded = `${encoded.slice(0, -1)}${alphabet[finalIndex ^ 1]}`;
    expect(Buffer.from(aliasEncoded, "base64url")).toEqual(Buffer.from(encoded, "base64url"));
    expect(aliasEncoded).not.toBe(encoded);
    expect(() => tokens.decodeTask(codex, `task-${aliasEncoded}`)).toThrowError(
      expect.objectContaining({ code: "invalid_path" }),
    );
  });

  it("binds ciphertext to panel, runtime, adapter version, kind, and process key", () => {
    const firstProcess = codec(3);
    const nextProcess = codec(4);
    const task = firstProcess.encodeTask(codex, "raw-task");
    const cursor = firstProcess.encodeCursor(codex, "raw-cursor");
    const wrongRuntime = { ...codex, runtime: "hermes" } as PanelTokenScope;
    const wrongAdapter = { ...codex, adapterVersion: "hermes-v1" } as PanelTokenScope;

    for (const decode of [
      () => firstProcess.decodeTask(hermes, task),
      () => firstProcess.decodeTask(wrongRuntime, task),
      () => firstProcess.decodeTask(wrongAdapter, task),
      () => firstProcess.decodeTask(codex, cursor),
      () => firstProcess.decodeCursor(codex, task),
      () => nextProcess.decodeTask(codex, task),
    ]) {
      expect(decode).toThrowError(expect.objectContaining({ code: "invalid_path" }));
    }
  });

  it("fails every invalid selector before a runtime reader can run", () => {
    const tokens = codec(5);
    const task = tokens.encodeTask(codex, "raw-task");
    let readerCalls = 0;
    const read = (scope: PanelTokenScope, selector: string) => {
      const raw = tokens.decodeTask(scope, selector);
      readerCalls += 1;
      return raw;
    };

    expect(() => read(hermes, task)).toThrowError(
      expect.objectContaining({ code: "invalid_path" }),
    );
    expect(readerCalls).toBe(0);
  });

  it("shares the process token key across isolated server module evaluations", async () => {
    vi.resetModules();
    const first = await import("@/server/panels/opaque-token");
    const task = first.panelTokenCodec.encodeTask(codex, "raw-cross-bundle-task");
    const cursor = first.panelTokenCodec.encodeCursor(codex, "raw-cross-bundle-cursor");

    vi.resetModules();
    const second = await import("@/server/panels/opaque-token");

    expect(second.panelTokenCodec).not.toBe(first.panelTokenCodec);
    expect(second.panelTokenCodec.decodeTask(codex, task)).toBe("raw-cross-bundle-task");
    expect(second.panelTokenCodec.decodeCursor(codex, cursor)).toBe("raw-cross-bundle-cursor");
  });
});
