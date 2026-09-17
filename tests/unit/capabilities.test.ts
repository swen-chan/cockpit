import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { systemSourceSchema } from "@/contracts/source-result";
import {
  readSkillPreview,
  readSkillsSource,
  readToolsSource,
} from "@/server/adapters/capabilities";
import type { HermesContext } from "@/server/config/hermes-context";

describe("skills and tools adapters", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function fixture(): { context: HermesContext; home: string } {
    const home = mkdtempSync(path.join(tmpdir(), "cockpit-capabilities-"));
    roots.push(home);
    mkdirSync(path.join(home, "skills", "research", "enabled-skill"), { recursive: true });
    mkdirSync(path.join(home, "skills", "productivity", "disabled-skill"), { recursive: true });
    mkdirSync(path.join(home, "skills", ".archive", "hidden-skill"), { recursive: true });
    mkdirSync(path.join(home, "skills", "research", "broken-skill"), { recursive: true });
    mkdirSync(path.join(home, "skills", "research", "github_pat_1234567890abcdef"), {
      recursive: true,
    });
    writeFileSync(
      path.join(home, "config.yaml"),
      [
        "model:",
        "  default: fixture-model",
        "  provider: fixture-provider",
        "  api_key: sk-proj-do-not-return-this",
        "platform_toolsets:",
        "  cli: [file, web, plugin-observer]",
        "known_builtin_toolsets:",
        "  cli: [file, web, vision]",
        "known_plugin_toolsets:",
        "  cli: [plugin-observer]",
        "agent:",
        "  disabled_toolsets: [vision]",
        "skills:",
        "  disabled: [disabled-skill]",
        "  platform_disabled:",
        "    cli: []",
      ].join("\n"),
    );
    writeFileSync(
      path.join(home, "skills", "research", "enabled-skill", "SKILL.md"),
      [
        "---",
        "name: enabled-skill",
        "description: Performs bounded fixture research.",
        "metadata:",
        "  hermes:",
        "    category: research",
        "---",
        "# Enabled",
        "Private path: /Users/private-name/project",
        "api_key: sk-proj-secret-example-value",
        "BODY_ONLY_MARKER",
      ].join("\n"),
    );
    writeFileSync(
      path.join(home, "skills", "productivity", "disabled-skill", "SKILL.md"),
      [
        "---",
        "name: disabled-skill",
        "description: A disabled fixture skill.",
        "---",
        "# Disabled",
      ].join("\n"),
    );
    writeFileSync(
      path.join(home, "skills", ".archive", "hidden-skill", "SKILL.md"),
      ["---", "name: hidden-skill", "description: Must stay hidden.", "---"].join("\n"),
    );
    writeFileSync(
      path.join(home, "skills", "research", "broken-skill", "SKILL.md"),
      "# no frontmatter",
    );
    writeFileSync(
      path.join(home, "skills", "research", "github_pat_1234567890abcdef", "SKILL.md"),
      ["---", "name: must-not-be-listed", "description: Must stay private.", "---"].join("\n"),
    );
    return {
      home,
      context: { home, profile: "default", profileKind: "default", source: "explicit" },
    };
  }

  it("lists safe skill metadata, exclusions, status, and no bodies", async () => {
    const { context, home } = fixture();
    const outside = mkdtempSync(path.join(tmpdir(), "cockpit-capabilities-outside-"));
    roots.push(outside);
    mkdirSync(path.join(outside, "escaped"));
    writeFileSync(
      path.join(outside, "escaped", "SKILL.md"),
      "---\nname: escaped\ndescription: outside\n---\n",
    );
    symlinkSync(path.join(outside, "escaped"), path.join(home, "skills", "escaped-link"));

    const source = await readSkillsSource(context, "config.yaml", new Date("2026-09-04T00:00:00Z"));
    expect(systemSourceSchema.safeParse(source).success).toBe(true);
    expect(source.collection?.kind).toBe("skills");
    expect(source.collection?.items.map((item) => item.name)).toEqual([
      "broken-skill",
      "disabled-skill",
      "enabled-skill",
    ]);
    expect(source.collection?.items.find((item) => item.name === "enabled-skill")?.status).toBe(
      "enabled",
    );
    expect(source.collection?.items.find((item) => item.name === "disabled-skill")?.status).toBe(
      "disabled",
    );
    expect(source.collection?.items.find((item) => item.name === "broken-skill")?.status).toBe(
      "error",
    );
    const serialized = JSON.stringify(source);
    expect(serialized).not.toContain("BODY_ONLY_MARKER");
    expect(serialized).not.toContain(home);
    expect(serialized).not.toContain("hidden-skill");
    expect(serialized).not.toContain("escaped");
    expect(serialized).not.toContain("sk-proj");
    expect(serialized).not.toContain("github_pat_");
    expect(serialized).not.toContain("must-not-be-listed");
  });

  it("loads one bounded skill body by opaque id and redacts sensitive text", async () => {
    const { context, home } = fixture();
    const index = await readSkillsSource(context, "config.yaml");
    const id = index.collection?.items.find((item) => item.name === "enabled-skill")?.id;
    expect(id).toMatch(/^skill-[a-f0-9]{24}$/u);

    const preview = await readSkillPreview(context, id!);
    expect(preview.content).toContain("BODY_ONLY_MARKER");
    expect(preview.content).toContain("<local-path>");
    expect(preview.content).not.toContain("sk-proj-secret-example-value");
    expect(JSON.stringify(preview)).not.toContain(home);
    await expect(readSkillPreview(context, "../../config.yaml")).rejects.toMatchObject({
      code: "invalid_path",
    });
  });

  it("derives observable CLI toolset states from allowlisted config fields", async () => {
    const { context, home } = fixture();
    const source = await readToolsSource(context, "config.yaml", new Date("2026-09-04T00:00:00Z"));
    expect(systemSourceSchema.safeParse(source).success).toBe(true);
    expect(source.collection?.items.map(({ name, status }) => [name, status])).toEqual([
      ["file", "enabled"],
      ["plugin-observer", "enabled"],
      ["vision", "disabled"],
      ["web", "enabled"],
    ]);
    expect(source.collection?.items.find((item) => item.name === "plugin-observer")?.category).toBe(
      "Plugin",
    );
    expect(source.collection?.items.find((item) => item.name === "file")?.description).toBe(
      "Enabled by platform_toolsets.cli.",
    );
    expect(source.collection?.items.find((item) => item.name === "vision")?.description).toBe(
      "Disabled by agent.disabled_toolsets.",
    );
    const serialized = JSON.stringify(source);
    expect(serialized).not.toContain(home);
    expect(serialized).not.toContain("api_key");
    expect(serialized).not.toContain("sk-proj");
  });
});
