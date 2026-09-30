import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";

export const claudeFixtureIds = Object.freeze(
  Array.from(
    { length: 7 },
    (_, index) => `33333333-3333-4333-8333-${String(index + 1).padStart(12, "0")}`,
  ),
);
export const claudeOtherProjectId = "55555555-5555-4555-8555-555555555555";

export const forbiddenClaudeFixtureMarkers = Object.freeze([
  "CLAUDE_OLD_BRANCH_MARKER",
  "CLAUDE_RAW_ARGUMENT_MARKER",
  "CLAUDE_RAW_OUTPUT_MARKER",
  "CLAUDE_RAW_ERROR_MARKER",
  "CLAUDE_RAW_THINKING_MARKER",
  "CLAUDE_RAW_SIGNATURE_MARKER",
  "CLAUDE_RAW_TOOL_NAME_MARKER",
  "CLAUDE_RAW_IMAGE_MARKER",
  "CLAUDE_CREDENTIAL_MARKER",
  "CLAUDE_NESTED_AGENT_MARKER",
  "CLAUDE_PRIVATE_CONFIG_MARKER",
  "CLAUDE_RAW_CWD_MARKER",
]);

function record(
  sessionId: string,
  type: "user" | "assistant" | "system",
  uuid: string,
  parentUuid: string | null,
  content: unknown,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type,
    uuid,
    parentUuid,
    sessionId,
    timestamp: "2026-09-28T00:00:00.000Z",
    message: { role: type, content },
    ...extra,
  };
}

export function createClaudeFixture(root: string) {
  const sessionRoot = path.join(root, "sessions");
  const workspaceRoot = path.join(root, "atlas-demo");
  const memoryRoot = path.join(root, "atlas-memory");
  const userRoot = path.join(root, "user-claude");
  const notesSessionRoot = path.join(root, "notes-sessions");
  const notesWorkspaceRoot = path.join(root, "notes-workspace");
  const notesMemoryRoot = path.join(root, "notes-memory");
  const projects = Object.freeze([
    Object.freeze({ id: "atlas", name: "Atlas", sessionRoot, workspaceRoot, memoryRoot }),
    Object.freeze({
      id: "notes",
      name: "Notes",
      sessionRoot: notesSessionRoot,
      workspaceRoot: notesWorkspaceRoot,
      memoryRoot: notesMemoryRoot,
    }),
  ]);
  const files: Record<string, string> = {
    [path.join(workspaceRoot, "CLAUDE.md")]:
      "# Atlas guidance\nReview settings changes with focused checks.\n",
    [path.join(workspaceRoot, ".claude", "rules", "frontend.md")]:
      "# Frontend rules\nKeep accessible control labels.\n",
    [path.join(workspaceRoot, ".claude", "skills", "review-settings", "SKILL.md")]:
      "# Review settings\nCheck the saved settings flow and its tests.\n",
    [path.join(workspaceRoot, ".claude", "agents", "reviewer.md")]:
      "# Settings reviewer\nReview settings changes for accessibility.\n",
    [path.join(workspaceRoot, ".claude", "settings.json")]:
      '{"private":"CLAUDE_PRIVATE_CONFIG_MARKER"}\n',
    [path.join(workspaceRoot, ".env")]: "API_KEY=CLAUDE_CREDENTIAL_MARKER\n",
    [path.join(workspaceRoot, "src", "settings.ts")]:
      "export const settings = { notifications: true };\n",
    [path.join(workspaceRoot, "docs", "review.md")]:
      "# Settings review\nVerify keyboard interaction before merging.\n",
    [path.join(memoryRoot, "MEMORY.md")]:
      "# Atlas memory\nThe settings page uses a single save action.\n",
    [path.join(userRoot, "CLAUDE.md")]:
      "# Shared guidance\nKeep changes small and explain verification.\n",
    [path.join(userRoot, "skills", "concise-review", "SKILL.md")]:
      "# Concise review\nSummarize the concrete change and checks.\n",
    [path.join(notesWorkspaceRoot, "CLAUDE.md")]:
      "# Notes guidance\nKeep release notes readable for end users.\n",
    [path.join(notesWorkspaceRoot, "docs", "release-plan.md")]:
      "# Release plan\nDescribe the changes and known limits.\n",
    [path.join(notesMemoryRoot, "MEMORY.md")]:
      "# Notes memory\nPublish release notes after human review.\n",
  };
  for (const [filename, content] of Object.entries(files)) {
    mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    writeFileSync(filename, content, { mode: 0o600 });
  }
  mkdirSync(notesSessionRoot, { recursive: true, mode: 0o700 });
  writeFileSync(
    path.join(notesSessionRoot, `${claudeOtherProjectId}.jsonl`),
    [
      record(
        claudeOtherProjectId,
        "user",
        "notes-user",
        null,
        "Draft the release notes for review.",
      ),
      record(
        claudeOtherProjectId,
        "assistant",
        "notes-answer",
        "notes-user",
        "The release plan is ready for human review.",
      ),
      {
        type: "custom-title",
        customTitle: "Plan the release notes",
        sessionId: claudeOtherProjectId,
      },
    ]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n",
    { mode: 0o600 },
  );
  mkdirSync(path.join(sessionRoot, "subagents"), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(root, "config.json"), "CLAUDE_PRIVATE_CONFIG_MARKER\n", { mode: 0o600 });
  writeFileSync(
    path.join(sessionRoot, "subagents", "44444444-4444-4444-8444-444444444444.jsonl"),
    JSON.stringify({ type: "user", message: { content: "CLAUDE_NESTED_AGENT_MARKER" } }) + "\n",
    { mode: 0o600 },
  );

  for (const [index, id] of claudeFixtureIds.entries()) {
    const title =
      index === 0
        ? "Inspect saved changes"
        : index === 1
          ? "Continue after compaction"
          : `Saved session ${index + 1}`;
    let entries: Record<string, unknown>[];
    if (index === 0) {
      entries = [
        record(id, "user", "u1", null, [
          { type: "text", text: "Review the saved changes in this project." },
        ]),
        record(id, "assistant", "old-answer", "u1", [
          { type: "text", text: "CLAUDE_OLD_BRANCH_MARKER" },
        ]),
        record(id, "assistant", "tool-calls", "u1", [
          {
            type: "tool_use",
            id: "read-call",
            name: "Read",
            input: {
              file_path: path.join(workspaceRoot, "src", "settings.ts"),
              token: "CLAUDE_RAW_ARGUMENT_MARKER",
            },
          },
          {
            type: "tool_use",
            id: "command-call",
            name: "Bash",
            input: { command: "pnpm test", token: "CLAUDE_RAW_ARGUMENT_MARKER" },
          },
          {
            type: "tool_use",
            id: "edit-call",
            name: "Edit",
            input: { old_string: "CLAUDE_RAW_ARGUMENT_MARKER" },
          },
          {
            type: "tool_use",
            id: "unknown-call",
            name: "CLAUDE_RAW_TOOL_NAME_MARKER",
            input: { secret: "CLAUDE_RAW_ARGUMENT_MARKER" },
          },
        ]),
        record(id, "user", "tool-results", "tool-calls", [
          {
            type: "tool_result",
            tool_use_id: "command-call",
            content:
              "Settings test failed: the save control has no accessible label.\napi_key=CLAUDE_RAW_ERROR_MARKER",
            is_error: true,
          },
          {
            type: "tool_result",
            tool_use_id: "read-call",
            content:
              "export const settings = { notifications: true };\napi_key=CLAUDE_RAW_OUTPUT_MARKER",
          },
        ]),
        record(id, "assistant", "recheck-call", "tool-results", [
          { type: "text", text: "I will check the revised changes." },
          {
            type: "tool_use",
            id: "recheck-command-call",
            name: "Bash",
            input: { command: "pnpm test", token: "CLAUDE_RAW_ARGUMENT_MARKER" },
          },
        ]),
        record(id, "user", "recheck-result", "recheck-call", [
          {
            type: "tool_result",
            tool_use_id: "recheck-command-call",
            content: "12 settings checks passed.\napi_key=CLAUDE_RAW_OUTPUT_MARKER",
          },
        ]),
        record(id, "assistant", "current-answer", "recheck-result", [
          {
            type: "thinking",
            thinking: "CLAUDE_RAW_THINKING_MARKER",
            signature: "CLAUDE_RAW_SIGNATURE_MARKER",
          },
          { type: "image", source: { type: "base64", data: "CLAUDE_RAW_IMAGE_MARKER" } },
          { type: "text", text: "The selected saved changes are ready to inspect." },
          {
            type: "text",
            text: "![External image](https://example.invalid/claude-image.png)\n<script>window.CLAUDE_SCRIPT_EXECUTION = true</script>\napi_key: CLAUDE_CREDENTIAL_MARKER",
          },
        ]),
      ];
    } else if (index === 1) {
      entries = [
        record(id, "user", "earlier-request", null, "Inspect earlier work."),
        record(id, "assistant", "earlier-answer", "earlier-request", "Earlier saved response."),
        record(id, "system", "compact-boundary", null, "Compact boundary", {
          subtype: "compact_boundary",
        }),
        record(
          id,
          "user",
          "compact-summary",
          "compact-boundary",
          "Saved context from earlier work.",
          {
            isCompactSummary: true,
          },
        ),
        record(
          id,
          "assistant",
          "continued-answer",
          "compact-summary",
          "Continued from saved context.",
        ),
      ];
    } else {
      entries = [
        record(id, "user", `u${index}`, null, `Inspect saved session ${index + 1}.`),
        record(id, "assistant", `a${index}`, `u${index}`, `Saved answer ${index + 1}.`),
      ];
    }
    if (index < 2) {
      for (const entry of entries) {
        entry.cwd = "/private/CLAUDE_RAW_CWD_MARKER/atlas-demo";
        entry.gitBranch = index === 0 ? "fix/session-reading" : "refactor/context";
      }
    }
    entries.push({ type: "custom-title", customTitle: title, sessionId: id });
    const file = path.join(sessionRoot, `${id}.jsonl`);
    writeFileSync(file, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n", {
      mode: 0o600,
    });
    const modificationTime = new Date(Date.UTC(2026, 8, 28, 1, 0, 0) - index * 60_000);
    utimesSync(file, modificationTime, modificationTime);
  }
  return Object.freeze({
    root,
    sessionRoot,
    workspaceRoot,
    memoryRoot,
    userRoot,
    projects,
    ids: claudeFixtureIds,
    environment: Object.freeze({
      COCKPIT_CLAUDE_PROJECTS: JSON.stringify(projects),
      COCKPIT_CLAUDE_USER_ROOT: userRoot,
    }),
  });
}
