import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { HermesContext } from "@/server/config/hermes-context";
import type { PrivateSourceManifest } from "@/server/config/source-manifest";
import { profileSummaryWithoutConfig, readProfileSummary } from "@/server/adapters/profile-config";
import { readSystemDocument } from "@/server/adapters/system-documents";
import { readSystemPrompt } from "@/server/adapters/system-prompt";
import { SourceSecurityError } from "@/server/security/errors";

const manifest: PrivateSourceManifest = {
  configRelativePath: "settings.yaml",
  conversation: {
    databaseRelativePath: "conversation-store.sqlite",
    sessionTable: "conversation_records",
    promptTable: "snapshot_records",
    sessionColumns: {
      id: "record_id",
      source: "origin_kind",
      title: "safe_title",
      startedAt: "created_time",
      endedAt: "closed_time",
      lastActivityAt: "recent_time",
      messageCount: "visible_count",
      hidden: "is_hidden",
      archived: "is_archived",
      promptHash: "snapshot_ref",
      embeddedPrompt: "legacy_body",
    },
    promptColumns: { hash: "fingerprint", prompt: "body" },
  },
};

describe("Task 5 local adapters", () => {
  let root = "";
  let home = "";
  let workspace = "";
  let context: HermesContext;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "cockpit-system-adapters-"));
    home = path.join(root, "home");
    workspace = path.join(root, "workspace");
    mkdirSync(path.join(home, "memories"), { recursive: true });
    mkdirSync(workspace);
    context = {
      home,
      profile: "default",
      profileKind: "default",
      source: "platform-default",
    };
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("constructs a new allowlisted profile summary without secret configuration fields", async () => {
    writeFileSync(
      path.join(home, "settings.yaml"),
      [
        "model:",
        "  default: safe-model",
        "  provider: safe-provider",
        "  base_url: https://private.invalid",
        "  api_key: sk-proj-this-must-not-cross",
        "headers:",
        "  authorization: Bearer this-must-not-cross",
        "environment: PRIVATE_TOKEN",
      ].join("\n"),
    );

    const summary = await readProfileSummary(context, manifest.configRelativePath);

    expect(summary).toMatchObject({
      profile: "default",
      homeLabel: home,
      configState: "ready",
      model: "safe-model",
      provider: "safe-provider",
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("private.invalid");
    expect(serialized).not.toContain("sk-proj");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("PRIVATE_TOKEN");
  });

  it("keeps the resolved custom Hermes home visible when configuration is unavailable", () => {
    const customContext: HermesContext = {
      home,
      profile: "custom",
      profileKind: "custom",
      source: "explicit",
    };

    expect(profileSummaryWithoutConfig(customContext)).toMatchObject({
      profile: "custom",
      homeLabel: home,
      configState: "unavailable",
    });
  });

  it("supports a paired nested model/provider value", async () => {
    writeFileSync(
      path.join(home, "settings.yaml"),
      ["model:", "  default:", "    model: nested-model", "    provider: nested-provider"].join(
        "\n",
      ),
    );
    await expect(readProfileSummary(context, manifest.configRelativePath)).resolves.toMatchObject({
      model: "nested-model",
      provider: "nested-provider",
      configState: "ready",
    });
  });

  it("distinguishes missing, malformed, and oversized configuration", async () => {
    await expect(readProfileSummary(context, manifest.configRelativePath)).resolves.toMatchObject({
      configState: "unavailable",
    });

    writeFileSync(path.join(home, "settings.yaml"), "model: [unterminated", "utf8");
    await expect(readProfileSummary(context, manifest.configRelativePath)).resolves.toMatchObject({
      configState: "error",
    });

    writeFileSync(path.join(home, "settings.yaml"), "x".repeat(256 * 1_024 + 1), "utf8");
    await expect(readProfileSummary(context, manifest.configRelativePath)).resolves.toMatchObject({
      configState: "error",
    });
  });

  it("reads bounded named documents and reports missing sources independently", async () => {
    writeFileSync(
      path.join(workspace, "SOUL.md"),
      `# Principles\n\n/Users/private-name/AI/Hermes\n\napi_key: ordinary-private-value\n\n${"a".repeat(110_000)}`,
      "utf8",
    );
    const spec = {
      id: "soul" as const,
      title: "SOUL.md",
      category: "Operating principles",
      summary: "Fixture principles.",
      root: workspace,
      relativePath: "SOUL.md",
      displayPath: "Hermes workspace / SOUL.md",
      sourceLabel: "Approved workspace",
    };

    const ready = await readSystemDocument(spec, new Date("2026-09-01T00:00:00Z"));
    expect(ready.stamp).toMatchObject({ state: "ready", truncated: true });
    expect(ready.content.length).toBeLessThanOrEqual(100_000);
    expect(ready.content).toContain("<local-path>");
    expect(ready.content).not.toContain("private-name");
    expect(ready.content).not.toContain("ordinary-private-value");
    expect(JSON.stringify(ready)).not.toContain(workspace);

    rmSync(path.join(workspace, "SOUL.md"));
    await expect(readSystemDocument(spec)).resolves.toMatchObject({
      stamp: { state: "unavailable" },
      content: expect.stringContaining("not available"),
    });
  });

  it("selects the latest eligible prompt, excluding cron, hidden, and archived rows", async () => {
    const database = new Database(path.join(home, manifest.conversation.databaseRelativePath));
    database.exec(`
      CREATE TABLE conversation_records (
        record_id TEXT PRIMARY KEY,
        origin_kind TEXT NOT NULL,
        safe_title TEXT,
        created_time REAL NOT NULL,
        closed_time REAL,
        recent_time REAL,
        visible_count INTEGER,
        is_hidden INTEGER,
        is_archived INTEGER,
        snapshot_ref TEXT,
        legacy_body TEXT
      );
      CREATE TABLE snapshot_records (fingerprint TEXT PRIMARY KEY, body TEXT NOT NULL);
      INSERT INTO snapshot_records VALUES ('abcdef1234567890', '# Eligible prompt\n\nWorkspace: /Users/private-name/AI/Hermes');
      INSERT INTO conversation_records VALUES ('eligible', 'cli', 'Eligible conversation', 100, NULL, 350, 2, 0, 0, 'abcdef1234567890', '# Legacy fallback');
      INSERT INTO conversation_records VALUES ('cron', 'cron', 'Automation', 100, NULL, 500, 2, 0, 0, 'abcdef1234567890', NULL);
      INSERT INTO conversation_records VALUES ('hidden', 'cli', 'Hidden', 100, NULL, 450, 2, 1, 0, 'abcdef1234567890', NULL);
      INSERT INTO conversation_records VALUES ('archived', 'cli', 'Archived', 100, NULL, 400, 2, 0, 1, 'abcdef1234567890', NULL);
    `);
    database.close();

    const source = await readSystemPrompt(
      context,
      manifest.conversation,
      new Date("2026-09-01T00:00:00Z"),
    );
    expect(source).toMatchObject({
      content: "# Eligible prompt\n\nWorkspace: <local-path>",
      stamp: { state: "ready" },
      metadata: expect.arrayContaining([
        { label: "Used by", value: "Eligible conversation" },
        { label: "Resolution", value: "Hash-matched snapshot" },
      ]),
    });
    expect(JSON.stringify(source)).not.toContain(home);
  });

  it("falls back to the embedded prompt when the hash snapshot is unavailable", async () => {
    const database = new Database(path.join(home, manifest.conversation.databaseRelativePath));
    database.exec(`
      CREATE TABLE conversation_records (
        record_id TEXT PRIMARY KEY, origin_kind TEXT NOT NULL, safe_title TEXT,
        created_time REAL NOT NULL, visible_count INTEGER, is_hidden INTEGER,
        is_archived INTEGER, snapshot_ref TEXT, legacy_body TEXT
      );
      CREATE TABLE snapshot_records (fingerprint TEXT PRIMARY KEY, body TEXT NOT NULL);
      INSERT INTO conversation_records VALUES ('eligible', 'cli', NULL, 100, 1, 0, 0, 'deadbeef1234', '# Embedded prompt');
    `);
    database.close();

    const source = await readSystemPrompt(context, manifest.conversation);
    expect(source.content).toBe("# Embedded prompt");
    expect(source.metadata).toContainEqual({
      label: "Resolution",
      value: "Embedded compatibility fallback",
    });
    expect(source.metadata).toContainEqual({ label: "Used by", value: "Untitled conversation" });
  });

  it("returns safe unavailable, malformed, and busy prompt states", async () => {
    await expect(readSystemPrompt(context, manifest.conversation)).resolves.toMatchObject({
      stamp: { state: "unavailable" },
    });

    const database = new Database(path.join(home, manifest.conversation.databaseRelativePath));
    database.exec("CREATE TABLE unrelated_records (id INTEGER PRIMARY KEY)");
    database.close();
    await expect(readSystemPrompt(context, manifest.conversation)).resolves.toMatchObject({
      stamp: { state: "error" },
      metadata: expect.arrayContaining([
        { label: "Diagnostic", value: "source_malformed", mono: true },
      ]),
    });

    await expect(
      readSystemPrompt(context, manifest.conversation, new Date(), {
        databaseReader: async () => {
          throw new SourceSecurityError("source_busy");
        },
      }),
    ).resolves.toMatchObject({
      stamp: { state: "error" },
      metadata: expect.arrayContaining([{ label: "Diagnostic", value: "source_busy", mono: true }]),
    });
  });
});
