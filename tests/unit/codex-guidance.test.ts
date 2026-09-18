// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { codexGuidanceSourceSchema } from "@/contracts/codex";
import { loadCodexGuidanceSources } from "@/server/codex/guidance";
import type { CodexPanelDescriptor } from "@/server/panels/registry";
import { resolvePanel, resolvePanelRegistry } from "@/server/panels/registry";

function panel(
  home: string,
  workspaceRoot?: string,
  customGuidance?: string,
): CodexPanelDescriptor {
  const resolved = resolvePanel(
    resolvePanelRegistry({
      COCKPIT_CODEX_HOME: home,
      ...(workspaceRoot ? { COCKPIT_CODEX_WORKSPACE_ROOT: workspaceRoot } : {}),
      ...(customGuidance ? { COCKPIT_CODEX_CUSTOM_GUIDANCE: customGuidance } : {}),
    }),
    "codex",
  );
  if (resolved.runtime !== "codex") throw new Error("synthetic panel mismatch");
  return resolved;
}

describe("current Codex guidance reader", () => {
  let fixture = "";
  let home = "";
  let workspace = "";

  beforeEach(() => {
    fixture = mkdtempSync(path.join(tmpdir(), "cockpit-codex-guidance-"));
    home = path.join(fixture, "codex-home");
    workspace = path.join(fixture, "workspace");
    mkdirSync(home);
    mkdirSync(workspace);
  });

  afterEach(() => rmSync(fixture, { recursive: true, force: true }));

  it("uses override precedence and never mixes in the lower-precedence base", async () => {
    writeFileSync(path.join(home, "AGENTS.override.md"), "override marker");
    writeFileSync(path.join(home, "AGENTS.md"), "base marker");

    const sources = await loadCodexGuidanceSources(panel(home));

    expect(sources).toEqual([
      expect.objectContaining({
        key: "global-guidance",
        state: "ready",
        content: "override marker",
      }),
    ]);
    expect(JSON.stringify(sources)).not.toContain("base marker");
  });

  it("falls back from a missing, zero-byte, or whitespace-only override and treats an empty base as missing", async () => {
    writeFileSync(path.join(home, "AGENTS.md"), "base marker");
    await expect(loadCodexGuidanceSources(panel(home))).resolves.toEqual([
      expect.objectContaining({ state: "ready", content: "base marker" }),
    ]);

    writeFileSync(path.join(home, "AGENTS.override.md"), "");
    await expect(loadCodexGuidanceSources(panel(home))).resolves.toEqual([
      expect.objectContaining({ state: "ready", content: "base marker" }),
    ]);

    writeFileSync(path.join(home, "AGENTS.override.md"), " \n\t\ufeff\r\n");
    await expect(loadCodexGuidanceSources(panel(home))).resolves.toEqual([
      expect.objectContaining({ state: "ready", content: "base marker" }),
    ]);

    writeFileSync(path.join(home, "AGENTS.md"), "");
    await expect(loadCodexGuidanceSources(panel(home))).resolves.toEqual([
      {
        key: "global-guidance",
        label: "Global guidance",
        state: "missing",
        message: "No current guidance was observed.",
      },
    ]);
  });

  it("does not fall back when an existing override is oversized or unreadable", async () => {
    const override = path.join(home, "AGENTS.override.md");
    writeFileSync(path.join(home, "AGENTS.md"), "base marker");
    writeFileSync(override, "x".repeat(256 * 1_024 + 1));

    await expect(loadCodexGuidanceSources(panel(home))).resolves.toEqual([
      {
        key: "global-guidance",
        label: "Global guidance",
        state: "error",
        message: "Current guidance could not be read safely.",
      },
    ]);

    writeFileSync(override, "private override");
    chmodSync(override, 0o000);
    const unreadable = await loadCodexGuidanceSources(panel(home, home));
    chmodSync(override, 0o600);
    expect(unreadable).toEqual([
      {
        key: "global-guidance",
        label: "Global guidance",
        state: "error",
        message: "Current guidance could not be read safely.",
      },
    ]);
    expect(JSON.stringify(unreadable)).not.toContain("base marker");
  });

  it("keeps roots independent and reports configured custom guidance separately", async () => {
    const missingHome = path.join(fixture, "missing-home");
    writeFileSync(path.join(workspace, "AGENTS.md"), "workspace marker");
    writeFileSync(path.join(workspace, "SOUL.md"), "custom marker");

    const sources = await loadCodexGuidanceSources(panel(missingHome, workspace, "SOUL.md"));

    expect(sources).toEqual([
      {
        key: "global-guidance",
        label: "Global guidance",
        state: "unavailable",
        message: "Current guidance is unavailable.",
      },
      expect.objectContaining({
        key: "workspace-guidance",
        state: "ready",
        content: "workspace marker",
      }),
      expect.objectContaining({ key: "custom-guidance", state: "ready", content: "custom marker" }),
    ]);
  });

  it("deduplicates the same canonical file across global, workspace, and custom scopes", async () => {
    writeFileSync(path.join(home, "AGENTS.md"), "one canonical marker");
    symlinkSync(path.join(home, "AGENTS.md"), path.join(home, "SOUL.md"));

    const sources = await loadCodexGuidanceSources(panel(home, home, "SOUL.md"));

    expect(sources).toEqual([
      expect.objectContaining({
        key: "global-guidance",
        state: "ready",
        content: "one canonical marker",
      }),
    ]);
  });

  it("deduplicates the same canonical source even when its selected read fails", async () => {
    writeFileSync(path.join(home, "AGENTS.override.md"), "x".repeat(256 * 1_024 + 1));

    const sources = await loadCodexGuidanceSources(panel(home, home));

    expect(sources).toEqual([
      {
        key: "global-guidance",
        label: "Global guidance",
        state: "error",
        message: "Current guidance could not be read safely.",
      },
    ]);
  });

  it("rejects a named-pipe override without blocking or falling back to the base", async () => {
    const fifo = path.join(home, "AGENTS.override.md");
    execFileSync("mkfifo", [fifo]);
    writeFileSync(path.join(home, "AGENTS.md"), "base marker");
    const anchor = openSync(fifo, constants.O_RDWR | constants.O_NONBLOCK);

    try {
      await expect(loadCodexGuidanceSources(panel(home, home))).resolves.toEqual([
        {
          key: "global-guidance",
          label: "Global guidance",
          state: "error",
          message: "Current guidance could not be read safely.",
        },
      ]);
    } finally {
      closeSync(anchor);
    }
  });

  it("fails only an escaping custom source and redacts safe ready content", async () => {
    writeFileSync(
      path.join(home, "AGENTS.md"),
      "Home: /Users/private-name/project\napi_key: super-secret-value",
    );
    writeFileSync(path.join(workspace, "AGENTS.md"), "workspace marker");
    const outside = path.join(fixture, "outside.md");
    writeFileSync(outside, "outside private marker");
    symlinkSync(outside, path.join(workspace, "SOUL.md"));

    const sources = await loadCodexGuidanceSources(panel(home, workspace, "SOUL.md"));

    expect(sources.map((source) => codexGuidanceSourceSchema.safeParse(source).success)).toEqual([
      true,
      true,
      true,
    ]);
    expect(sources.at(-1)).toEqual({
      key: "custom-guidance",
      label: "Custom guidance",
      state: "error",
      message: "Current guidance could not be read safely.",
    });
    const serialized = JSON.stringify(sources);
    expect(serialized).toContain("<local-path>");
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).not.toContain("private-name");
    expect(serialized).not.toContain("super-secret-value");
    expect(serialized).not.toContain("outside private marker");
    expect(serialized).not.toContain(home);
  });

  it("applies the full Codex text policy to guidance content", async () => {
    writeFileSync(
      path.join(home, "AGENTS.md"),
      [
        "safe guidance marker",
        "https://alice:swordfish@example.invalid/path",
        "https://example.invalid/?%61ccess_token=encoded-secret",
        "/root/private-agent",
        "/private/tmp/private-agent",
        String.raw`\\private-server\private-share\private-agent`,
        "\u001b[31mterminal-control\u001b[0m",
        "direction\u202ereversed",
      ].join("\n"),
    );

    const sources = await loadCodexGuidanceSources(panel(home));
    const serialized = JSON.stringify(sources);

    expect(sources.map((source) => codexGuidanceSourceSchema.safeParse(source).success)).toEqual([
      true,
    ]);
    expect(serialized).toContain("safe guidance marker");
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).toContain("<local-path>");
    for (const privateFragment of [
      "swordfish",
      "encoded-secret",
      "/root/private-agent",
      "/private/tmp/private-agent",
      "private-server",
      "private-share",
      "\u001b",
      "\u202e",
    ])
      expect(serialized).not.toContain(privateFragment);
  });
});
