// @vitest-environment node

import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { claudeSystemSnapshotSchema } from "@/contracts/claude-system";
import { loadClaudeSystem } from "@/server/claude/system";
import type { ClaudePanelDescriptor } from "@/server/panels/registry";

describe("Claude current System sources", () => {
  let root: string;
  let workspace: string;
  let memory: string;
  let userRoot: string;
  let panel: ClaudePanelDescriptor;

  async function write(relativePath: string, content: string) {
    const filename = path.join(root, relativePath);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, content);
    return filename;
  }

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "cockpit-claude-system-"));
    workspace = path.join(root, "workspace");
    memory = path.join(root, "memory");
    userRoot = path.join(root, "user");
    await Promise.all([workspace, memory, userRoot].map((directory) => mkdir(directory)));
    panel = {
      id: "claude-code",
      name: "Claude Code",
      runtime: "claude-code",
      adapterVersion: "claude-sdk-0.3.283",
      surfaces: ["overview", "conversations", "system", "files"],
      configuration: {
        projects: [
          {
            id: "example",
            name: "Example",
            sessionRoot: path.join(root, "sessions"),
            workspaceRoot: workspace,
            memoryRoot: memory,
          },
        ],
        userRoot,
      },
    };
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  it("rejects source reads during a guarded production build", async () => {
    vi.stubEnv("COCKPIT_BUILD_SOURCE_READ_GUARD", "1");
    await expect(loadClaudeSystem(panel)).rejects.toThrow("guarded production build");
  });

  it("reads allowlisted project and user documents without following imports or modifying files", async () => {
    const guidance = await write(
      "workspace/CLAUDE.md",
      "# Project guide\n\nUse pnpm.\n@outside.md",
    );
    await write("workspace/CLAUDE.local.md", "Local preferences");
    await write("workspace/AGENTS.md", "Shared agent guidance");
    await write("workspace/.claude/CLAUDE.md", "Additional project guidance");
    await write("workspace/.claude/rules/frontend/accessibility.md", "Keyboard navigation rule");
    await write(
      "workspace/.claude/skills/review/SKILL.md",
      "---\nname: review\n---\nInspect the diff",
    );
    await write("workspace/.claude/skills/review/run.sh", "NON_DOCUMENT_SCRIPT");
    await write("workspace/.claude/agents/reviewer.md", "Review implementation details");
    await write("workspace/.claude/settings.json", "PRIVATE_CONFIGURATION");
    await write("workspace/outside.md", "IMPORT_MUST_NOT_BE_FOLLOWED");
    await write("memory/MEMORY.md", "# Saved topics\n\nSee tests.md");
    await write("memory/tests.md", "A saved testing preference");
    await write("user/CLAUDE.md", "Personal guidance");
    await write("user/rules/style.md", "Personal style rule");
    await write("user/skills/check/SKILL.md", "Personal check");
    await write("user/agents/analyst.md", "Personal analyst definition");
    const before = await readFile(guidance);

    const snapshot = await loadClaudeSystem(panel, "example");

    expect(snapshot.sources).toHaveLength(13);
    expect(snapshot.sources.filter((source) => source.category === "Memory")).toHaveLength(2);
    expect(snapshot.sources.filter((source) => source.scope === "User")).toHaveLength(4);
    expect(
      snapshot.sources.find(
        (source) => source.relativePath === ".claude/rules/frontend/accessibility.md",
      )?.content,
    ).toBe("Keyboard navigation rule");
    expect(snapshot.unavailableScopes).toEqual([]);
    expect(snapshot.limited).toBe(false);
    const json = JSON.stringify(snapshot);
    expect(json).not.toContain(root);
    expect(json).not.toMatch(
      /PRIVATE_CONFIGURATION|NON_DOCUMENT_SCRIPT|IMPORT_MUST_NOT_BE_FOLLOWED/u,
    );
    expect(await readFile(guidance)).toEqual(before);
    expect(claudeSystemSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it("does not let an instruction file or a Claude directory symlink escape the approved workspace", async () => {
    await write("outside/CLAUDE.md", "OUTSIDE_PRIVATE_GUIDANCE");
    await symlink(path.join(root, "outside/CLAUDE.md"), path.join(workspace, "CLAUDE.md"));
    await symlink(path.join(root, "outside"), path.join(workspace, ".claude"));

    const snapshot = await loadClaudeSystem(panel);

    expect(snapshot.sources).toEqual([
      expect.objectContaining({ relativePath: "CLAUDE.md", state: "unavailable", content: null }),
    ]);
    expect(snapshot.unavailableScopes).toEqual(["Project"]);
    expect(JSON.stringify(snapshot)).not.toContain("OUTSIDE_PRIVATE_GUIDANCE");
  });

  it("reads discovered filenames as literal text, including spaces and percent signs", async () => {
    await write("workspace/.claude/rules/report%20draft.md", "Literal percent rule");
    await write("workspace/.claude/rules/report draft.md", "Different space rule");
    await write("workspace/.claude/skills/100% complete/SKILL.md", "Percent skill");

    const snapshot = await loadClaudeSystem(panel);

    expect(snapshot.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relativePath: ".claude/rules/report%20draft.md",
          content: "Literal percent rule",
          state: "ready",
        }),
        expect.objectContaining({
          relativePath: ".claude/rules/report draft.md",
          content: "Different space rule",
          state: "ready",
        }),
        expect.objectContaining({
          relativePath: ".claude/skills/100% complete/SKILL.md",
          content: "Percent skill",
          state: "ready",
        }),
      ]),
    );
  });

  it("rejects aliases to excluded directories and omits hidden or credential-named documents", async () => {
    await write("workspace/.git/CLAUDE.md", "EXCLUDED_GIT_CONTENT");
    await symlink(path.join(workspace, ".git"), path.join(workspace, ".claude"));
    await write("user/rules/.hidden.md", "HIDDEN_CONTENT");
    await write("user/rules/token.md", "Credential filename must be excluded");
    await write("user/rules/normal.md", "Visible rule");

    const snapshot = await loadClaudeSystem(panel);

    expect(snapshot.unavailableScopes).toContain("Project");
    expect(snapshot.sources.some((source) => source.relativePath.includes(".hidden"))).toBe(false);
    expect(snapshot.sources.some((source) => source.relativePath.includes("token.md"))).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain("EXCLUDED_GIT_CONTENT");
    expect(
      snapshot.sources.find((source) => source.relativePath === "rules/normal.md")?.content,
    ).toBe("Visible rule");
  });

  it("redacts local paths and credentials from document text and preserves safe Markdown", async () => {
    await write(
      "workspace/CLAUDE.md",
      `# Guide\n\nworkspace: ${workspace}\n\napi_key: sk-ant-test-secret-value-123456789\n\n[Docs](https://example.invalid)\n\n![Remote](https://example.invalid/image.png)`,
    );

    const snapshot = await loadClaudeSystem(panel);
    const content = snapshot.sources[0]?.content;

    expect(content).not.toContain(workspace);
    expect(content).not.toContain("sk-ant-test-secret-value-123456789");
    expect(content).toContain("# Guide");
    expect(content).toContain("https://example.invalid");
  });

  it("caps each document and the total snapshot without claiming a complete index", async () => {
    await write("workspace/CLAUDE.md", "a".repeat(100_000));
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        write(
          `workspace/.claude/rules/rule-${String(index).padStart(2, "0")}.md`,
          "b".repeat(30_000),
        ),
      ),
    );

    const snapshot = await loadClaudeSystem(panel);

    expect(snapshot.sources[0]?.truncated).toBe(true);
    expect(snapshot.sources.every((source) => (source.content?.length ?? 0) <= 20_000)).toBe(true);
    expect(
      Buffer.byteLength(snapshot.sources.map((source) => source.content ?? "").join("")),
    ).toBeLessThanOrEqual(256 * 1_024);
    expect(snapshot.limited).toBe(true);
    expect(snapshot.sources.length).toBeLessThan(21);
  });

  it("distinguishes missing documents from an unavailable configured source", async () => {
    const empty = await loadClaudeSystem(panel);
    expect(empty.sources).toEqual([]);
    expect(empty.unavailableScopes).toEqual([]);

    await rm(memory, { recursive: true });
    const missing = await loadClaudeSystem(panel);
    expect(missing.sources).toEqual([]);
    expect(missing.unavailableScopes).toEqual(["Memory"]);
  });

  it("selects only an explicitly configured project and rejects an unknown project", async () => {
    await write("workspace/CLAUDE.md", "First project");
    await write("second/CLAUDE.md", "Second project");
    const multiPanel: ClaudePanelDescriptor = {
      ...panel,
      configuration: {
        ...panel.configuration,
        projects: [
          ...panel.configuration.projects,
          {
            id: "second",
            name: "Second",
            sessionRoot: path.join(root, "other-sessions"),
            workspaceRoot: path.join(root, "second"),
          },
        ],
      },
    };

    const snapshot = await loadClaudeSystem(multiPanel, "second");
    expect(snapshot.sources[0]?.content).toBe("Second project");
    expect(JSON.stringify(snapshot)).not.toContain("First project");
    await expect(loadClaudeSystem(multiPanel, "unknown")).rejects.toThrow();
  });
});
