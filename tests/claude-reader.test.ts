// @vitest-environment node

import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { claudeSessionDetailSchema } from "@/contracts/claude";
import { readClaudeSession, readClaudeSessionPage } from "@/server/claude/reader";
import { panelTokenCodec } from "@/server/panels/opaque-token";
import type { ClaudePanelDescriptor } from "@/server/panels/registry";

const roots: string[] = [];
const id = "11111111-1111-4111-8111-111111111111";
const tokenScope = {
  panelId: "claude-code",
  runtime: "claude-code",
  adapterVersion: "claude-sdk-0.3.283",
} as const;

function fixture(): ClaudePanelDescriptor {
  const root = mkdtempSync(path.join(tmpdir(), "cockpit-claude-reader-"));
  roots.push(root);
  mkdirSync(path.join(root, "sessions"));
  mkdirSync(path.join(root, "workspace"));
  return {
    id: "claude-code",
    name: "Claude Code",
    runtime: "claude-code",
    adapterVersion: "claude-sdk-0.3.283",
    surfaces: ["overview", "system", "conversations", "files"],
    configuration: {
      projects: [
        {
          id: "project",
          name: "Project",
          sessionRoot: path.join(root, "sessions"),
          workspaceRoot: path.join(root, "workspace"),
        },
      ],
    },
  };
}

function entry(
  type: "user" | "assistant" | "system",
  uuid: string,
  parentUuid: string | null,
  content: unknown,
  extra = {},
) {
  return {
    type,
    uuid,
    parentUuid,
    sessionId: id,
    timestamp: "2026-09-28T00:00:00.000Z",
    message: { role: type, content },
    ...extra,
  };
}

function save(panel: ClaudePanelDescriptor, entries: unknown[], sessionId = id, suffix = "") {
  const filename = path.join(panel.configuration.projects[0]!.sessionRoot, `${sessionId}.jsonl`);
  writeFileSync(filename, entries.map((value) => JSON.stringify(value)).join("\n") + "\n" + suffix);
  return filename;
}

function hash(filename: string) {
  return createHash("sha256").update(readFileSync(filename)).digest("hex");
}

function sessionToken(panel: ClaudePanelDescriptor, sessionId = id) {
  const project = panel.configuration.projects[0]!;
  const projectKey = createHash("sha256")
    .update(
      JSON.stringify([
        project.id,
        path.resolve(project.sessionRoot),
        path.resolve(project.workspaceRoot),
        project.memoryRoot ? path.resolve(project.memoryRoot) : null,
        panel.configuration.userRoot ? path.resolve(panel.configuration.userRoot) : null,
      ]),
    )
    .digest("base64url");
  return panelTokenCodec.encodeTask(tokenScope, `${projectKey}:${sessionId}`);
}

async function detail(panel: ClaudePanelDescriptor) {
  return readClaudeSession(panel, sessionToken(panel));
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Claude Code bounded saved-session reader", () => {
  it("blocks reads during a guarded build before touching a source", async () => {
    const panel = fixture();
    vi.stubEnv("COCKPIT_BUILD_SOURCE_READ_GUARD", "1");
    await expect(readClaudeSessionPage(panel)).rejects.toThrow("guarded production build");
    await expect(detail(panel)).rejects.toThrow("guarded production build");
  });

  it("uses the pinned SDK's selected chain, exposes readable labels, and leaves files untouched", async () => {
    const panel = fixture();
    const filename = save(panel, [
      entry("user", "u1", null, "Investigate the import"),
      entry("assistant", "old", "u1", "Discarded branch"),
      entry("assistant", "new", "u1", [{ type: "text", text: "Selected saved answer" }]),
      { type: "custom-title", sessionId: id, customTitle: "Import investigation" },
    ]);
    const before = hash(filename);
    const beforeNames = readdirSync(panel.configuration.projects[0]!.sessionRoot);
    const page = await readClaudeSessionPage(panel);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      title: "Import investigation",
      preview: "Investigate the import",
      directoryName: null,
      gitBranch: null,
      issue: null,
    });
    expect(page.scope).toBe("Configured Claude Code session directory");
    const saved = await readClaudeSession(panel, page.items[0]!.id);
    expect(saved.messages.map((message) => message.content)).toEqual([
      "Investigate the import",
      "Selected saved answer",
    ]);
    expect(saved).toMatchObject({ directoryName: null, gitBranch: null });
    expect(
      saved.messages.every((message) => message.timestamp === "2026-09-28T00:00:00.000Z"),
    ).toBe(true);
    expect(JSON.stringify(saved)).not.toContain(id);
    expect(hash(filename)).toBe(before);
    expect(readdirSync(panel.configuration.projects[0]!.sessionRoot)).toEqual(beforeNames);
  });

  it("shows recorded directory and branch labels in list and detail without exposing cwd", async () => {
    const panel = fixture();
    const cwd = "/synthetic/projects/saved-project";
    save(panel, [
      entry("user", "u1", null, "Inspect the project", { cwd, gitBranch: "feature/saved-session" }),
    ]);
    const saved = await detail(panel);
    expect(saved).toMatchObject({
      directoryName: "saved-project",
      gitBranch: "feature/saved-session",
    });
    expect(JSON.stringify(saved)).not.toContain(cwd);
    expect(JSON.stringify(saved)).not.toContain("/synthetic/projects");
    const page = await readClaudeSessionPage(panel);
    expect(page.items[0]).toMatchObject({
      directoryName: "saved-project",
      gitBranch: "feature/saved-session",
    });
    expect(JSON.stringify(page)).not.toContain(cwd);
    expect(JSON.stringify({ page, saved })).not.toContain("projectLabel");
    save(panel, [
      entry("user", "u1", null, "Inspect the project", {
        cwd: "/synthetic/projects/credentials.json",
      }),
    ]);
    expect(await detail(panel)).toMatchObject({ directoryName: null, gitBranch: null });
    expect((await readClaudeSessionPage(panel)).items[0]).toMatchObject({
      directoryName: null,
      gitBranch: null,
    });
  });

  it("lets a recorded rewind choose the previous branch through the SDK", async () => {
    const panel = fixture();
    save(panel, [
      entry("user", "u1", null, "Question"),
      entry("assistant", "old", "u1", "Rewound saved answer"),
      entry("assistant", "new", "u1", "Abandoned newer answer"),
      entry("user", "meta", "old", "LOCAL_COMMAND_HIDDEN", { isMeta: true }),
    ]);
    expect((await detail(panel)).messages.map((message) => message.content)).toEqual([
      "Question",
      "Rewound saved answer",
    ]);
  });

  it("keeps sidechain and teammate records out of the SDK's main saved conversation", async () => {
    const panel = fixture();
    save(panel, [
      entry("user", "u1", null, "Main question"),
      entry("assistant", "a1", "u1", "Main answer"),
      entry("assistant", "side", "u1", "SUBAGENT_CONTENT", {
        isSidechain: true,
        agentId: "private-agent",
      }),
      entry("assistant", "team", "u1", "TEAMMATE_CONTENT", { teamName: "private-team" }),
    ]);
    expect((await detail(panel)).messages.map((message) => message.content)).toEqual([
      "Main question",
      "Main answer",
    ]);
  });

  it("keeps SDK compaction preservation and labels an identified summary", async () => {
    const panel = fixture();
    save(panel, [
      entry("user", "u1", null, "Preserved question"),
      entry("assistant", "a1", "u1", [
        { type: "text", text: "Preserved answer" },
        { type: "tool_use", id: "preserved-call", name: "Read", input: {} },
      ]),
      entry("system", "boundary", null, "", {
        subtype: "compact_boundary",
        compactMetadata: { preservedMessages: { uuids: ["u1", "a1"], anchorUuid: "summary" } },
      }),
      entry("user", "summary", "boundary", "Context summary", { isCompactSummary: true }),
      entry("user", "u2", "summary", "Continue"),
      entry("assistant", "a2", "u2", "After compaction"),
    ]);
    const saved = await detail(panel);
    expect(saved.messages.map((message) => [message.role, message.content])).toEqual([
      ["summary", "Context summary"],
      ["user", "Preserved question"],
      ["assistant", "Preserved answer"],
      ["user", "Continue"],
      ["assistant", "After compaction"],
    ]);
    expect(saved.limited).toBe(false);
    expect(saved.activities).toMatchObject([{ messageKey: saved.messages[2]!.key }]);
    expect(saved.activities[0]!.messageKey).not.toBe(saved.messages[0]!.key);
  });

  it("hides unsupported tool payloads, unapproved file results and thinking", async () => {
    const panel = fixture();
    save(panel, [
      entry("user", "u1", null, "Read the file"),
      entry("assistant", "a1", "u1", [
        { type: "thinking", thinking: "PRIVATE_REASONING", signature: "PRIVATE_SIGNATURE" },
        {
          type: "tool_use",
          id: "raw-tool-id-1",
          name: "Read",
          input: { file_path: "/tmp/RAW_FILE_PATH" },
        },
        { type: "tool_use", id: "raw-tool-id-2", name: "Bash", input: { command: "RAW_COMMAND" } },
        { type: "tool_use", id: "raw-tool-id-3", name: "RAW_CUSTOM_TOOL_NAME", input: {} },
      ]),
      entry("user", "r1", "a1", [
        { type: "tool_result", tool_use_id: "raw-tool-id-1", content: "RAW_TOOL_OUTPUT" },
        {
          type: "tool_result",
          tool_use_id: "raw-tool-id-2",
          content: "RAW_ERROR_OUTPUT",
          is_error: true,
        },
      ]),
      entry("assistant", "a2", "r1", [
        { type: "text", text: "The saved answer" },
        { type: "image", source: { url: "https://example.invalid/TRACKING_IMAGE" } },
      ]),
    ]);
    const saved = await detail(panel);
    expect(saved.activities.map(({ category, state }) => [category, state])).toEqual([
      ["Read", "result_recorded"],
      ["Command", "recorded_error"],
      ["Other", "no_result_recorded"],
    ]);
    expect(saved.messages.map((message) => message.content)).toEqual([
      "Read the file",
      null,
      "The saved answer",
    ]);
    expect(saved.messages[1]).toMatchObject({ role: "assistant", content: null });
    expect(
      saved.activities.every((activity) => activity.messageKey === saved.messages[1]!.key),
    ).toBe(true);
    expect(JSON.stringify(saved)).not.toMatch(/RAW_|PRIVATE_|raw-tool-id|TRACKING_IMAGE/u);
    expect(claudeSessionDetailSchema.safeParse({ ...saved, raw: "payload" }).success).toBe(false);
  });

  it("associates repeated tools with their own saved messages and matches reversed returns by ID", async () => {
    const panel = fixture();
    save(panel, [
      entry("user", "u1", null, "Check the saved changes"),
      entry("assistant", "a1", "u1", [
        { type: "text", text: "The first recorded check." },
        { type: "tool_use", id: "first-check", name: "Bash", input: {} },
      ]),
      entry("assistant", "a2", "a1", [
        { type: "tool_use", id: "second-check", name: "Bash", input: {} },
        { type: "tool_use", id: "missing-check", name: "Bash", input: {} },
      ]),
      entry("user", "r1", "a2", [
        { type: "tool_result", tool_use_id: "second-check", content: "RAW_SECOND_RESULT" },
        {
          type: "tool_result",
          tool_use_id: "first-check",
          content: "RAW_FIRST_ERROR",
          is_error: true,
        },
      ]),
      entry("assistant", "a3", "r1", "The saved conclusion."),
    ]);
    const saved = await detail(panel);
    expect(saved.messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: "user", content: "Check the saved changes" },
      { role: "assistant", content: "The first recorded check." },
      { role: "assistant", content: null },
      { role: "assistant", content: "The saved conclusion." },
    ]);
    expect(
      saved.activities.map(({ category, messageKey, state }) => ({ category, messageKey, state })),
    ).toEqual([
      { category: "Command", messageKey: saved.messages[1]!.key, state: "recorded_error" },
      { category: "Command", messageKey: saved.messages[2]!.key, state: "result_recorded" },
      { category: "Command", messageKey: saved.messages[2]!.key, state: "no_result_recorded" },
    ]);
    expect(JSON.stringify(saved)).not.toMatch(/RAW_|first-check|second-check|missing-check/u);
  });

  it("projects existing file references and bounded recorded results without claiming completion", async () => {
    const panel = fixture();
    const workspace = panel.configuration.projects[0]!.workspaceRoot;
    const filename = path.join(workspace, "report.md");
    writeFileSync(filename, "Current report differs from the recorded result.");
    const before = hash(filename);
    save(panel, [
      entry("user", "u1", null, "Review the report"),
      entry("assistant", "a1", "u1", [
        {
          type: "tool_use",
          id: "read",
          name: "Read",
          input: { file_path: filename, ignored: "HIDDEN_INPUT" },
        },
        {
          type: "tool_use",
          id: "edit",
          name: "Edit",
          input: { file_path: filename, old_string: "HIDDEN_OLD", new_string: "HIDDEN_NEW" },
        },
        {
          type: "tool_use",
          id: "write",
          name: "Write",
          input: { file_path: filename, content: "HIDDEN_WRITE_CONTENT" },
        },
        {
          type: "tool_use",
          id: "check",
          name: "Bash",
          input: { command: "pnpm test", description: "HIDDEN_BASH_DESCRIPTION" },
        },
        {
          type: "tool_use",
          id: "agent",
          name: "Agent",
          input: { description: "Review report assumptions", prompt: "HIDDEN_DELEGATED_PROMPT" },
        },
      ]),
      entry("user", "r1", "a1", [
        { type: "tool_result", tool_use_id: "read", content: "Earlier recorded report." },
        {
          type: "tool_result",
          tool_use_id: "edit",
          content: "Edit could not be applied.",
          is_error: true,
        },
        {
          type: "tool_result",
          tool_use_id: "check",
          content: [
            { type: "text", text: "Tests 12 passed" },
            { type: "image", source: { data: "HIDDEN_IMAGE" } },
          ],
          exitCode: 0,
        },
        {
          type: "tool_result",
          tool_use_id: "agent",
          content: "Review the migration assumptions before publishing.",
        },
      ]),
    ]);
    const saved = await detail(panel);
    expect(
      saved.activities.map(({ label, filePath, command, state, result }) => ({
        label,
        filePath,
        command,
        state,
        result,
      })),
    ).toEqual([
      {
        label: "Read report.md",
        filePath: "report.md",
        command: null,
        state: "result_recorded",
        result: { text: "Earlier recorded report.", truncated: false },
      },
      {
        label: "Edit report.md",
        filePath: "report.md",
        command: null,
        state: "recorded_error",
        result: { text: "Edit could not be applied.", truncated: false },
      },
      {
        label: "Write report.md",
        filePath: "report.md",
        command: null,
        state: "no_result_recorded",
        result: null,
      },
      {
        label: "Recorded command",
        filePath: null,
        command: "pnpm test",
        state: "result_recorded",
        result: { text: "Tests 12 passed", truncated: false },
      },
      {
        label: "Delegate: Review report assumptions",
        filePath: null,
        command: null,
        state: "result_recorded",
        result: { text: "Review the migration assumptions before publishing.", truncated: false },
      },
    ]);
    expect(JSON.stringify(saved)).not.toMatch(/HIDDEN_|exitCode|completed/u);
    expect(hash(filename)).toBe(before);
  });

  it.each([
    "pnpm test --token SECRET_ARGUMENT",
    "pnpm test --reporter SECRET_ARGUMENT",
    "pnpm test\ncat SECRET_ARGUMENT",
    "pnpm test && cat SECRET_ARGUMENT",
    "pnpm test; cat SECRET_ARGUMENT",
    "pnpm test | cat SECRET_ARGUMENT",
    "pnpm test > SECRET_ARGUMENT",
    "TOKEN=SECRET_ARGUMENT pnpm test",
    "pnpm test $(cat SECRET_ARGUMENT)",
    "node -e 'SECRET_ARGUMENT'",
    "bash -c 'pnpm test'",
    "pnpm test\u001b[0m SECRET_ARGUMENT",
  ])("hides shell scripts, parameters and their output: %s", async (command) => {
    const panel = fixture();
    save(panel, [
      entry("assistant", "a1", null, [
        { type: "tool_use", id: "check", name: "Bash", input: { command } },
      ]),
      entry("user", "r1", "a1", [
        { type: "tool_result", tool_use_id: "check", content: "HIDDEN_SCRIPT_OUTPUT" },
      ]),
    ]);
    const saved = await detail(panel);
    expect(saved.activities[0]).toMatchObject({
      command: null,
      result: null,
      state: "result_recorded",
    });
    expect(JSON.stringify(saved)).not.toMatch(/SECRET_ARGUMENT|HIDDEN_SCRIPT_OUTPUT/u);
  });

  it("redacts credentials and local paths before bounding recorded output and delegation descriptions", async () => {
    const panel = fixture();
    save(panel, [
      entry("assistant", "a1", null, [
        { type: "tool_use", id: "check", name: "Bash", input: { command: "pnpm verify" } },
        {
          type: "tool_use",
          id: "agent",
          name: "Agent",
          input: { description: "Review password=PRIVATE_DESCRIPTION", prompt: "PRIVATE_PROMPT" },
        },
      ]),
      entry("user", "r1", "a1", [
        {
          type: "tool_result",
          tool_use_id: "check",
          content:
            'Authorization: Bearer sk-synthetic-secret-value\npassword=PRIVATE_PASSWORD\n{"password":"PRIVATE_JSON_PASSWORD"}\n/tmp/PRIVATE_LOCATION\n' +
            "😀".repeat(3_000),
        },
        { type: "tool_result", tool_use_id: "agent", content: { raw: "PRIVATE_OBJECT" } },
      ]),
    ]);
    const saved = await detail(panel);
    expect(saved.activities[0]!.result?.truncated).toBe(true);
    expect(Array.from(saved.activities[0]!.result!.text).length).toBeLessThanOrEqual(2_000);
    expect(saved.activities[0]!.result!.text).not.toContain("\uFFFD");
    expect(saved.activities[1]!.result).toBeNull();
    expect(saved.limited).toBe(true);
    expect(JSON.stringify(saved)).not.toMatch(/PRIVATE_|sk-synthetic-secret-value/u);
  });

  it("does not link missing, excluded, relative, outside or symlink-escaped recorded file targets", async () => {
    const panel = fixture();
    const workspace = panel.configuration.projects[0]!.workspaceRoot;
    const other = fixture();
    const outside = path.join(other.configuration.projects[0]!.workspaceRoot, "outside.txt");
    writeFileSync(outside, "PRIVATE_OUTSIDE_CONTENT");
    writeFileSync(path.join(workspace, ".env"), "PRIVATE_CREDENTIAL_CONTENT");
    writeFileSync(path.join(workspace, "report.txt"), "Visible file");
    symlinkSync(outside, path.join(workspace, "linked.txt"));
    const candidates = [
      path.join(workspace, "missing.txt"),
      path.join(workspace, ".env"),
      "report.txt",
      outside,
      path.join(workspace, "linked.txt"),
      `${workspace}/../workspace/report.txt`,
    ];
    save(panel, [
      entry(
        "assistant",
        "a1",
        null,
        candidates.map((file_path, index) => ({
          type: "tool_use",
          id: `call-${index}`,
          name: "Read",
          input: { file_path },
        })),
      ),
      entry(
        "user",
        "r1",
        "a1",
        candidates.map((_, index) => ({
          type: "tool_result",
          tool_use_id: `call-${index}`,
          content: "PRIVATE_FILE_RESULT",
        })),
      ),
      entry("assistant", "a2", "r1", `The report is at ${path.join(workspace, "report.txt")}.`),
    ]);
    const saved = await detail(panel);
    expect(saved.activities).toHaveLength(candidates.length);
    expect(
      saved.activities.every((activity) => activity.filePath === null && activity.result === null),
    ).toBe(true);
    expect(saved.messages.at(-1)?.content).toContain("<local-path>");
    expect(JSON.stringify(saved)).not.toMatch(/PRIVATE_/u);
  });

  it("bounds the combined recorded output budget while retaining activity ownership", async () => {
    const panel = fixture();
    save(panel, [
      entry(
        "assistant",
        "a1",
        null,
        Array.from({ length: 100 }, (_, index) => ({
          type: "tool_use",
          id: `call-${index}`,
          name: "Bash",
          input: { command: "pnpm test" },
        })),
      ),
      entry(
        "user",
        "r1",
        "a1",
        Array.from({ length: 100 }, (_, index) => ({
          type: "tool_result",
          tool_use_id: `call-${index}`,
          content: "x".repeat(2_000),
        })),
      ),
    ]);
    const saved = await detail(panel);
    expect(saved.activities).toHaveLength(100);
    expect(saved.activities[0]!.result).toBeNull();
    expect(saved.activities.at(-1)!.result?.text).toHaveLength(2_000);
    expect(
      Buffer.byteLength(saved.activities.map((activity) => activity.result?.text ?? "").join("")),
    ).toBeLessThanOrEqual(64 * 1_024);
    expect(
      saved.activities.every((activity) => activity.messageKey === saved.messages[0]!.key),
    ).toBe(true);
    expect(saved.limited).toBe(true);
  });

  it("binds saved session and cursor tokens to the selected project and its configured roots", async () => {
    const panel = fixture();
    const other = fixture();
    save(panel, [entry("user", "u1", null, "First project")]);
    save(other, [entry("user", "u1", null, "Second project")]);
    for (let index = 2; index <= 6; index += 1) {
      save(
        panel,
        [entry("user", "u1", null, `Session ${index}`)],
        `${String(index).repeat(8)}-1111-4111-8111-111111111111`,
      );
    }
    const firstProject = panel.configuration.projects[0]!;
    const secondProject = { ...other.configuration.projects[0]!, id: "other", name: "Other" };
    const multiple: ClaudePanelDescriptor = {
      ...panel,
      configuration: { projects: [firstProject, secondProject] },
    };
    const page = await readClaudeSessionPage(multiple, null, firstProject.id);
    const token = page.items[0]!.id;
    await expect(readClaudeSession(multiple, token, secondProject.id)).rejects.toMatchObject({
      code: "invalid_path",
    });
    await expect(
      readClaudeSessionPage(multiple, page.nextCursor!, secondProject.id),
    ).rejects.toMatchObject({ code: "invalid_path" });
    const switched = {
      ...multiple,
      configuration: {
        projects: [{ ...firstProject, workspaceRoot: secondProject.workspaceRoot }],
      },
    };
    await expect(readClaudeSession(switched, token, firstProject.id)).rejects.toMatchObject({
      code: "invalid_path",
    });
    await expect(
      readClaudeSessionPage(switched, page.nextCursor!, firstProject.id),
    ).rejects.toMatchObject({ code: "invalid_path" });
    const secondPage = await readClaudeSessionPage(multiple, null, secondProject.id);
    expect(
      (await readClaudeSession(multiple, secondPage.items[0]!.id, secondProject.id)).messages[0]
        ?.content,
    ).toBe("Second project");
    expect(JSON.stringify({ page, secondPage })).not.toContain(firstProject.sessionRoot);
  });

  it.each([
    { reason: "message count", count: 250, text: "Recent saved text" },
    { reason: "text bytes", count: 14, text: "x".repeat(20_000) },
  ])(
    "leaves an activity unassociated when $reason truncates its owning message",
    async ({ count, text }) => {
      const panel = fixture();
      const entries = [
        entry("user", "u1", null, "Earlier request"),
        entry("assistant", "old-tool", "u1", [
          { type: "tool_use", id: "old-call", name: "Read", input: {} },
        ]),
      ];
      for (let index = 0; index < count; index += 1) {
        entries.push(
          entry("assistant", `recent-${index}`, index ? `recent-${index - 1}` : "old-tool", text),
        );
      }
      save(panel, entries);
      const saved = await detail(panel);
      expect(saved.limited).toBe(true);
      expect(saved.activities).toMatchObject([
        { key: "activity-1", messageKey: null, category: "Read", state: "no_result_recorded" },
      ]);
      expect(saved.messages.every((message) => message.content === text)).toBe(true);
    },
  );

  it("removes a tool-only message when all its activities fall outside the activity cap", async () => {
    const panel = fixture();
    save(panel, [
      entry("user", "u1", null, "Saved request"),
      entry("assistant", "old-tool", "u1", [
        { type: "tool_use", id: "old-call", name: "Read", input: {} },
      ]),
      entry(
        "assistant",
        "recent-tools",
        "old-tool",
        Array.from({ length: 300 }, (_, index) => ({
          type: "tool_use",
          id: `recent-call-${index}`,
          name: "Read",
          input: {},
        })),
      ),
      entry("assistant", "a3", "recent-tools", "Saved answer"),
    ]);
    const saved = await detail(panel);
    expect(saved.limited).toBe(true);
    expect(saved.activities).toHaveLength(300);
    expect(saved.messages.map((message) => message.content)).toEqual([
      "Saved request",
      null,
      "Saved answer",
    ]);
    expect(saved.messages[1]!.key).toBe("message-3");
    expect(
      saved.activities.every((activity) => activity.messageKey === saved.messages[1]!.key),
    ).toBe(true);
  });

  it("redacts paths and credentials in readable metadata and text without interpreting HTML", async () => {
    const panel = fixture();
    save(panel, [
      entry("user", "u1", null, "<script>window.syntheticProbe = true</script>"),
      entry(
        "assistant",
        "a1",
        "u1",
        "Read /Users/example/private/file.txt\nAuthorization: Bearer sk-synthetic-secret-value",
      ),
      { type: "custom-title", customTitle: "Inspect /Users/example/private/file.txt" },
    ]);
    const page = await readClaudeSessionPage(panel);
    const saved = await detail(panel);
    expect(page.items[0]?.title).not.toContain("/Users/");
    expect(saved.messages[0]?.content).toContain("<script>");
    expect(JSON.stringify(saved)).not.toContain("sk-synthetic-secret-value");
    expect(JSON.stringify(saved)).not.toContain("/Users/");
  });

  it("bounds incomplete final writes separately from malformed completed records", async () => {
    const panel = fixture();
    save(panel, [entry("user", "u1", null, "Saved prompt")], id, '{"type":"assistant"');
    const saved = await detail(panel);
    expect(saved.pendingWrite).toBe(true);
    expect(saved.messages.map((message) => message.content)).toEqual(["Saved prompt"]);
    const filename = path.join(panel.configuration.projects[0]!.sessionRoot, `${id}.jsonl`);
    writeFileSync(
      filename,
      Buffer.concat([
        Buffer.from(JSON.stringify(entry("user", "u1", null, "Saved prompt")) + "\n"),
        Buffer.from([0xf0, 0x9f]),
      ]),
    );
    expect((await detail(panel)).pendingWrite).toBe(true);
    writeFileSync(
      filename,
      Buffer.concat([
        Buffer.from([0xff, 10]),
        Buffer.from(JSON.stringify(entry("user", "u1", null, "Saved prompt"))),
      ]),
    );
    await expect(detail(panel)).rejects.toMatchObject({ code: "source_malformed" });
    writeFileSync(filename, '{"type":"assistant"\n');
    expect((await readClaudeSessionPage(panel)).items[0]?.issue).toBe("malformed");
    await expect(detail(panel)).rejects.toMatchObject({ code: "source_malformed" });
  });

  it("paginates titles and retains oversized files as bounded unavailable rows", async () => {
    const panel = fixture();
    for (let index = 1; index <= 7; index += 1) {
      const sessionId = `${String(index).repeat(8)}-1111-4111-8111-111111111111`;
      const filename = save(panel, [entry("user", "u1", null, `Session ${index}`)], sessionId);
      utimesSync(filename, index, index);
    }
    const first = await readClaudeSessionPage(panel);
    expect(first.items).toHaveLength(5);
    expect(first.items[0]?.preview).toBe("Session 7");
    const second = await readClaudeSessionPage(panel, first.nextCursor!);
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    const filename = save(panel, []);
    writeFileSync(filename, "x".repeat(8 * 1_024 * 1_024 + 1));
    expect((await readClaudeSessionPage(panel)).items[0]?.issue).toBe("too_large");
    await expect(detail(panel)).rejects.toMatchObject({ code: "source_too_large" });
  });

  it("continues after the last listed file when a new session is inserted between pages", async () => {
    const panel = fixture();
    for (let index = 1; index <= 7; index += 1) {
      const sessionId = `${String(index).repeat(8)}-1111-4111-8111-111111111111`;
      const filename = save(panel, [entry("user", "u1", null, `Session ${index}`)], sessionId);
      utimesSync(filename, 1, 1);
    }
    const first = await readClaudeSessionPage(panel);
    expect(first.items.map((session) => session.preview)).toEqual([
      "Session 1",
      "Session 2",
      "Session 3",
      "Session 4",
      "Session 5",
    ]);
    const inserted = save(
      panel,
      [entry("user", "u1", null, "New session")],
      "88888888-1111-4111-8111-111111111111",
    );
    utimesSync(inserted, 8, 8);
    const second = await readClaudeSessionPage(panel, first.nextCursor!);
    expect(second.items.map((session) => session.preview)).toEqual(["Session 6", "Session 7"]);
    expect(second.nextCursor).toBeNull();
    expect(first.nextCursor).not.toContain("55555555-1111-4111-8111-111111111111");
  });

  it("does not discover nested files or follow session-file symlinks", async () => {
    const panel = fixture();
    const other = fixture();
    const outside = save(other, [entry("user", "u1", null, "OUTSIDE_SOURCE")]);
    symlinkSync(outside, path.join(panel.configuration.projects[0]!.sessionRoot, `${id}.jsonl`));
    const nested = path.join(panel.configuration.projects[0]!.sessionRoot, "subagents");
    mkdirSync(nested);
    writeFileSync(path.join(nested, `${id}.jsonl`), readFileSync(outside));
    writeFileSync(
      path.join(panel.configuration.projects[0]!.sessionRoot, "not-a-uuid.jsonl"),
      "PRIVATE_NON_SESSION",
    );
    expect((await readClaudeSessionPage(panel)).items).toEqual([]);
    await expect(detail(panel)).rejects.toMatchObject({ code: "source_unavailable" });
    await expect(
      readClaudeSession(panel, panelTokenCodec.encodeTask(tokenScope, "../escape")),
    ).rejects.toMatchObject({ code: "invalid_path" });
    await expect(
      readClaudeSessionPage(panel, panelTokenCodec.encodeCursor(tokenScope, "-1")),
    ).rejects.toMatchObject({ code: "invalid_path" });
  });

  it("keeps the recent text within display limits and preserves non-BMP characters", async () => {
    const panel = fixture();
    const entries = [];
    for (let index = 0; index < 260; index += 1) {
      entries.push(
        entry(
          index % 2 ? "assistant" : "user",
          `m${index}`,
          index ? `m${index - 1}` : null,
          index === 259 ? "😀".repeat(20_001) : `Message ${index}`,
        ),
      );
    }
    save(panel, entries);
    const saved = await detail(panel);
    expect(saved.limited).toBe(true);
    expect(saved.messages).toHaveLength(250);
    expect(saved.messages[0]?.content).toBe("Message 10");
    expect(Array.from(saved.messages.at(-1)!.content!)).toHaveLength(16_384);
    expect(saved.messages.at(-1)?.content).not.toContain("\uFFFD");
  });
});
