import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { profileSummarySchema, systemSourceSchema } from "@/contracts/source-result";
import type { PrivateSourceManifest } from "@/server/config/source-manifest";
import { loadCoreSystemSources, loadSystemPageData } from "@/server/services/system";

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

describe("System page service", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function fixture(): { home: string; workspace: string } {
    const root = mkdtempSync(path.join(tmpdir(), "cockpit-system-service-"));
    roots.push(root);
    const home = path.join(root, "home");
    const workspace = path.join(root, "workspace");
    mkdirSync(path.join(home, "memories"), { recursive: true });
    mkdirSync(path.join(home, "skills", "research", "fixture-skill"), { recursive: true });
    mkdirSync(workspace);
    writeFileSync(path.join(home, "settings.yaml"), [
      "model:",
      "  default: fixture-model",
      "  provider: fixture-provider",
      "  api_key: sk-proj-never-serialize-this",
      "platform_toolsets:",
      "  cli: [file, web]",
      "known_builtin_toolsets:",
      "  cli: [file, web, vision]",
      "known_plugin_toolsets:",
      "  cli: []",
      "skills:",
      "  disabled: []",
    ].join("\n"));
    writeFileSync(path.join(home, "skills", "research", "fixture-skill", "SKILL.md"), [
      "---",
      "name: fixture-skill",
      "description: A safe fixture skill.",
      "metadata:",
      "  hermes:",
      "    category: research",
      "---",
      "# Fixture Skill",
    ].join("\n"));
    writeFileSync(path.join(home, "memories", "MEMORY.md"), "# Memory\n\nFixture memory.");
    writeFileSync(path.join(home, "memories", "USER.md"), "# User\n\nFixture profile.");
    writeFileSync(path.join(workspace, "SOUL.md"), "# Soul\n\nFixture principles.");
    writeFileSync(path.join(workspace, "AGENTS.md"), "# Agents\n\nFixture rules.");

    const database = new Database(path.join(home, manifest.conversation.databaseRelativePath));
    database.exec(`
      CREATE TABLE conversation_records (
        record_id TEXT PRIMARY KEY, origin_kind TEXT NOT NULL, safe_title TEXT,
        created_time REAL NOT NULL, recent_time REAL, visible_count INTEGER,
        is_hidden INTEGER, is_archived INTEGER, snapshot_ref TEXT, legacy_body TEXT
      );
      CREATE TABLE snapshot_records (fingerprint TEXT PRIMARY KEY, body TEXT NOT NULL);
      INSERT INTO snapshot_records VALUES ('abcdef1234567890', '# Runtime prompt');
      INSERT INTO conversation_records VALUES ('eligible', 'cli', 'Runtime fixture', 100, 200, 1, 0, 0, 'abcdef1234567890', NULL);
    `);
    database.close();
    return { home, workspace };
  }

  it("composes only strict browser-safe DTOs from independent real adapters", async () => {
    const { home, workspace } = fixture();
    const data = await loadSystemPageData({
      environment: {
        COCKPIT_WORKSPACE_ROOT: workspace,
        COCKPIT_HERMES_HOME: home,
      },
      manifest,
      platformRoot: home,
      now: new Date("2026-09-01T00:00:00Z"),
    });

    expect(profileSummarySchema.safeParse(data.profile).success).toBe(true);
    expect(data.sources).toHaveLength(8);
    expect(data.sources.every((source) => systemSourceSchema.safeParse(source).success)).toBe(true);
    expect(data.sources.every((source) => source.stamp.state === "ready")).toBe(true);
    expect(data.profile.homeLabel).toBe(realpathSync(home));
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain("sk-proj");
    expect(serialized).not.toContain("api_key");
    const nonProfileSources = data.sources.filter((source) => source.id !== "providers");
    expect(JSON.stringify(nonProfileSources)).not.toContain(realpathSync(home));
    expect(JSON.stringify(nonProfileSources)).not.toContain(realpathSync(workspace));
  });

  it("loads only the five core context sources for Overview composition", async () => {
    const { home, workspace } = fixture();
    const sources = await loadCoreSystemSources({
      environment: {
        COCKPIT_WORKSPACE_ROOT: workspace,
        COCKPIT_HERMES_HOME: home,
      },
      manifest,
      platformRoot: home,
      now: new Date("2026-09-01T00:00:00Z"),
    });

    expect(sources.map((source) => source.id)).toEqual(["prompt", "memory", "user", "soul", "agents"]);
    expect(sources.every((source) => systemSourceSchema.safeParse(source).success)).toBe(true);
    expect(sources.every((source) => source.stamp.state === "ready")).toBe(true);
  });

  it("preserves successful sections when another source is missing", async () => {
    const { home, workspace } = fixture();
    rmSync(path.join(home, manifest.conversation.databaseRelativePath));
    rmSync(path.join(home, "memories", "USER.md"));
    const data = await loadSystemPageData({
      environment: { COCKPIT_WORKSPACE_ROOT: workspace, COCKPIT_HERMES_HOME: home },
      manifest,
      platformRoot: home,
    });

    expect(data.sources.find((source) => source.id === "prompt")?.stamp.state).toBe("unavailable");
    expect(data.sources.find((source) => source.id === "user")?.stamp.state).toBe("unavailable");
    expect(data.sources.find((source) => source.id === "memory")?.stamp.state).toBe("ready");
    expect(data.sources.find((source) => source.id === "soul")?.stamp.state).toBe("ready");
    expect(data.sources.find((source) => source.id === "providers")?.stamp.state).toBe("ready");
  });
});
