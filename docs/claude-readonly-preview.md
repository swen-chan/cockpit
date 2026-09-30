# Claude Code project inspection — v0.4.0 preview

This preview provides project-scoped Conversations, Overview, System, and Files.
Conversations remain the default entry. The maintainer accepted the local UI
with fictional projects and chose to collect real-installation feedback during
the Developer Preview. No real Claude installation has been accepted locally.
Synthetic fixtures provide repeatable verification rather than proof of
compatibility with every installation.

## User outcomes

- Find a saved session by its readable title, first prompt, file update time,
  and optional recorded directory name and branch. Search only the already-loaded
  list, including those context labels; more rows are loaded explicitly.
- Select it to read the saved conversation selected by the pinned SDK, including
  recorded rewind and compaction behavior. Identified compaction summaries are
  labeled separately from user messages. The UI shows the most recent text first.
- Read the conversation first. Tool records are folded at the saved message that
  contains their call, with short error or missing-result notices visible while
  folded. Pure tool-call messages retain their own position; tool-result records
  are not presented as new human requests. Source details and explanations are
  available on demand. A recorded result does not establish task success or
  current liveness.
- See whether the source is empty, unreadable, incomplete, or bounded by a limit.
- Return to recent work from Overview, with direct links to the selected
  project's conversations, current System sources, and workspace.
- Inspect supported recorded operations, limited result excerpts, and approved
  file references. Open a current file and return to its owning session.
- Read current project and user instructions, memory, skills, and custom subagent
  definitions in System, with explicit source labels.
- Switch between explicitly configured projects while preserving the selected
  surface. Changing project clears a previous session or file selection.

Conversations retain three reading levels: messages, folded operations, and
source explanations. System and Files provide separate destinations for current
documents; they do not reconstruct historical files or prove task completion.

There is no Jobs surface. Switching from Hermes Jobs opens Conversations and
explains the change; other supported surfaces are preserved. Subagent transcripts,
automatic worktree aggregation, cost/token totals, Hooks/MCP diagnostics, and live
execution status remain outside this preview.

## Configuration and coverage

Set explicit project roots in the ignored `.env.local`:

```dotenv
COCKPIT_CLAUDE_PROJECTS='[{"id":"website","name":"Website","sessionRoot":"/absolute/path/to/claude/project-sessions","workspaceRoot":"/absolute/path/to/website","memoryRoot":"/absolute/path/to/claude/project-memory"},{"id":"notes","name":"Notes","sessionRoot":"/absolute/path/to/claude/notes-sessions","workspaceRoot":"/absolute/path/to/notes"}]'
# Optional shared user instructions, rules, skills, and subagent definitions:
COCKPIT_CLAUDE_USER_ROOT=/absolute/path/to/claude-user-directory
# Optional when several Agent panels are configured:
COCKPIT_DEFAULT_PANEL=claude-code
```

Each project needs a unique lowercase slug `id` (up to 40 characters), a safe
display `name` (up to 80 characters), and absolute `sessionRoot` and
`workspaceRoot` paths. `memoryRoot` is optional. Configure 1–12 projects, with
at most 200 KiB of JSON. Filesystem roots, malformed paths, unsafe names, duplicate
IDs, and unknown configuration fields are rejected without echoing their values.
The former `COCKPIT_CLAUDE_SESSION_ROOT` key now reports a configuration error:
remove it and set `COCKPIT_CLAUDE_PROJECTS`; there is no legacy fallback.

Claude Code documents saved sessions under `~/.claude/projects/`. For each
`sessionRoot`, choose the project directory containing saved session files, not
a workspace, Claude home, or the parent containing all projects. Cockpit inspects
only immediate regular files named with a UUID and `.jsonl`. It does not scan
nested directories, follow session-file symlinks, or discover worktrees. The
setting can be combined with existing Hermes and Codex settings independently.

The panel defaults to `/agents/claude-code/conversations`. Without a `project`
query, the first configured project is selected. A project slug keeps the same
scope across all four pages and API reads; unknown slugs fail rather than falling
back. Session and pagination tokens are bound to that configured scope. Project
selection never authorizes new filesystem roots. A missing configured session
source keeps the project selected and shows an error; an empty directory shows
an empty state. Restart Cockpit after changing configuration.

Coverage is the saved files in that directory, not a claim to reproduce Claude
Code's native resume menu. Files may include sessions created programmatically.
A title is presented neutrally: the SDK may derive it from a saved custom title,
an automatically generated title, or prompt metadata. No title is asserted to
have been authored by the user.

## Reader decision and alternatives

Cockpit pins `@anthropic-ai/claude-agent-sdk` to **0.3.283**, whose package records
Claude Code version **2.1.283**. This is a reader evidence point, not proof of
compatibility with every Claude Code installation or a requirement to run its
executable. No Claude executable, account, API key, or network call is needed
for these saved-session reads.

The SDK's public `getSessionInfo` and `getSessionMessages` APIs receive a
request-local `sessionStore`. Cockpit opens a bounded approved source first and
supplies those entries through `load`; `append` always refuses. The SDK selects
the effective conversation chain. Cockpit joins returned message UUIDs to the
already-read entries for timestamps, the compaction-summary marker, and metadata
message filtering.

Adopted: the upstream reader's branch, rewind, and compaction semantics, the
existing Cockpit path checks, source guards, opaque selectors, redaction,
allowlisted DTOs, and lazy detail UI.

Rejected: SDK filesystem discovery, because a missing requested session can
trigger a broader search; a second branch parser, because that would duplicate
upstream semantics; and a persistent index, watcher, or generic plugin layer,
because these explicitly configured, bounded project reads do not require them.

For tool placement, use the message containing the call and match recorded results
by the tool-call ID within the same SDK-selected chain. Only locally generated
message keys reach the browser. Do not infer turns from the nearest user record,
attach a tool to adjacent text, or create another history parser. Without this
small association, the former independent list loses the conversation context
needed to distinguish repeated tool categories.

The pinned package's optional Claude executable distributions are excluded in
`pnpm-workspace.yaml`. The JavaScript SDK and its peer dependencies remain
installed; existing Next.js/native dependencies keep their normal install rules.
The SDK stays server-only and is imported only for an explicit Claude read.

Primary references used for the decision:

- [Claude Code saved sessions](https://code.claude.com/docs/en/how-claude-code-works#work-with-sessions)
- [Claude Agent SDK TypeScript reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [SDK package 0.3.283](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk/v/0.3.283)
- The pinned package's `sdk.d.ts` and `sdk.mjs`, especially sessionStore routing,
  effective-chain selection, metadata extraction, and compaction preservation.

## Current System and Files

System groups discovered documents into Instructions, Memory, Skills, and
Subagents. The approved workspace contributes `CLAUDE.md`, `CLAUDE.local.md`,
`AGENTS.md` if present, and `.claude/CLAUDE.md`, `.claude/rules/**/*.md`,
`.claude/skills/*/SKILL.md`, and `.claude/agents/*.md`. The explicit memory root
contributes its immediate Markdown files. An optional shared user root contributes
its `CLAUDE.md`, rules, skills, and subagent definitions under a User label.
`AGENTS.md` is a discovered project guide, not a claim that Claude natively loaded
it. Raw settings, authentication, plugin discovery, and imported external files
are not loaded.

The System inventory is bounded to 100 documents, 500 directory entries, 32 KiB
per document, 256 KiB combined text, and eight nested rule-directory levels.
Search covers those displayed documents. Missing sources and partial results
remain visible; current discovery does not establish past session activation,
loading priority, or subagent execution.

Files reuse the existing approved-root browser, credential exclusions, bounded
previews, and inert Markdown rendering. A saved file-tool path becomes an
`Open file` link only when it resolves to a permitted current file inside the
selected workspace. The link carries a return reference to the same session.
File content is current, not a historical snapshot or a verified saved change.
Session and return links contain process-bound selectors: after restarting
Cockpit, reopen the session from its list rather than reusing an old link.

## Bounds and meaning

- Scan at most 5,000 directory entries and flag a partial inventory at the limit.
- Sort recognized files by file modification time; return five rows per page.
  For readable labels, metadata reads the bounded files on the requested page.
  It does not send transcript details to the browser until a session is selected.
- Read at most 8 MiB and 20,000 JSONL records per session. Oversized or malformed
  files remain visible as unavailable rows; details fail with a bounded error.
  Branch selection is never run on an arbitrary truncated prefix of an oversized
  file.
- An incomplete final record is omitted and flagged. Completed malformed records
  fail explicitly. A file changing during the read may require manual refresh.
- Display up to 250 recent message positions, 256 KiB combined text, and 300 recent
  tool activities. Each text message is limited to 20,000 characters / 64 KiB.
  Reaching these limits produces a visible notice.
  If an activity's owning message is outside the displayed range, show it under
  `Context not displayed`; never attach it to another message or summary.
- Tool data is projected into explicit fields; raw input/output objects, thinking,
  image blocks, internal identifiers, and arbitrary tool names do not enter DTOs.
  Supported file operations expose only approved relative paths. Commands are
  shown only for the fixed set of plain verification commands recognized by the
  reader; arbitrary shell expressions are omitted. Supported results are cleaned
  and limited to 2,000 characters per activity and 64 KiB combined. Categories are
  fixed. States mean only
  `Result recorded`, `Recorded error`, or `No result recorded` in the selected
  saved chain.
- An identified compaction summary can be shown; this is not a complete history
  of every compaction event. Independent subagent and teammate records are not
  displayed as the main conversation.
- If present, show the recorded directory basename and Git branch as secondary
  metadata in the list and source details. A basename is not a unique project or
  worktree identity. These do not establish the current working directory or checkout,
  and never grant Files access. Workspace access comes only from explicit project
  configuration. The full recorded directory is omitted.
- Observed time and file update time have separate labels. Neither implies that
  Claude Code is running. Pages and detail reads can observe different moments;
  list pagination continues below the previous page's time/ID boundary and is
  not a stable snapshot while files change. Reload the page to see newer sessions.

## Verification and acceptance

`pnpm verify` covers contracts, project scope/navigation dispatch, actual pinned SDK
branch/rewind/compaction reading, source immutability, malformed/partial data,
limits, privacy, and stale selection responses. `pnpm test:browser` adds Claude
only with two synthetic projects, three Agent panels, empty source, and missing
source scenarios to the existing Hermes/Codex regression suite. Claude checks
cover all four pages, project switching, operation/file round trips, and source
immutability. Only synthetic sources are used.
The browser command first builds the current source with the existing source-read
guard, then uses `next start` locally and in CI. It does not use development-mode
route compilation. Failure traces are retained separately for each scenario.

Early preview users can configure a narrow local project and check that familiar
titles, saved answers, a rewind, and a compacted conversation agree with their
Claude Code history. Verify System source
labels against actual files, inspect a recorded operation and its current file,
then switch projects and confirm every page stays in the selected scope.
Report mismatches through [GitHub Issues](https://github.com/swen-chan/cockpit/issues).
Include the Cockpit version or commit, Claude Code version, operating system,
affected page, short steps, and expected versus observed behavior. Use fictional
examples or sanitized screenshots; do not attach raw session files, credentials,
private paths, or configuration. Suspected security issues belong in private
vulnerability reporting, as described in [SECURITY.md](../SECURITY.md).
Real-installation evidence is a preview feedback track, not a claim established
by synthetic checks or a requirement for the maintainer to install Claude Code.
