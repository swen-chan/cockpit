# Cockpit v0.1 Requirements

## Status

Confirmed on 2026-08-28, implemented through Tasks 1–13, and accepted against
the real local Hermes sources under Task 14 on 2026-09-12.

This specification normalizes the agreed product direction in
`<local-path>/Hermes/docs/cockpit-v0.1-requirements.md` into the implemented,
testable v0.1 contract.

## Product statement

Cockpit v0.1 is a local, read-only observability surface for one Hermes agent
instance. It helps the local operator understand the context Hermes is operating from and
what recently happened across five surfaces:

- Overview
- System
- Conversations
- Files
- Jobs

The first release optimizes for trustworthy inspection, not control,
organization, or automation.

## Primary user and job

The primary user is one trusted local operator running Cockpit on the same
machine as Hermes.

The core job is:

> Open one place and quickly understand Hermes's active context, recent
> conversations, visible workspace files, and background jobs without changing
> Hermes state.

Here, Hermes state means its business records and source content. R1 defines
the sole narrow exception for SQLite-owned WAL coordination files.

## Scope

### In scope

- A localhost web application.
- One observable Hermes instance.
- Server-side, read-only access to approved local Hermes sources.
- A persistent, visible read-only indicator.
- Graceful partial results when a source is missing or temporarily unavailable.
- The five surfaces defined below.

### Out of scope

- Projects or project attribution.
- Conversation split, merge, link, unlink, rename, archive, or cleanup.
- Chat, messaging, replies, DMs, publishing, or social actions.
- Editing memory, prompts, instructions, skills, configuration, files, or jobs.
- Running, pausing, resuming, creating, or deleting jobs.
- Automatic classification, organization, summarization-to-memory, or cleanup.
- Telegram-, OpenClaw-, or deployment-specific product abstractions.
- Multi-agent orchestration or a public/team SaaS.
- A separate application database or backend service.

## Functional requirements

### R1. Local read-only application boundary

Cockpit shall run as a local web application and expose only inspection
capabilities.

Acceptance criteria:

1. While any Cockpit page is visible, the application shall display an
   unambiguous read-only status indicator.
2. When a user navigates among Overview, System, Conversations, Files, and
   Jobs, Cockpit shall render the requested surface without offering mutation
   controls.
3. When an HTTP request uses a mutation method against a Cockpit data endpoint,
   the server shall reject it rather than mutate Hermes state.
4. When Cockpit opens a SQLite source, it shall use `SQLITE_OPEN_READONLY` and
   enable `query_only` before issuing bounded reader statements.
5. Under that read-only SQLite connection only, SQLite may create or restore an
   empty `-wal` file with no transaction frames and may create or update the
   disposable `-shm` wal-index. Cockpit shall not modify a main database, an
   existing non-empty WAL file, a business record, or any other Hermes file; this
   coordination exception is not general write authorization.
6. When Cockpit reads a file source, it shall not create, modify, rename, move,
   or delete that source.
7. When the local server starts without explicit host configuration, it shall
   bind to a loopback interface rather than a public network interface.

### R2. Overview

Overview shall communicate Hermes's current observable state at a glance.

Acceptance criteria:

1. When Overview loads, Cockpit shall show the resolved Hermes profile and
   resolved Hermes home without exposing credentials.
2. When safe model/provider metadata is available, Cockpit shall show the
   active model/provider summary.
3. When session data is available, Cockpit shall show a compact recent
   conversation summary.
4. When job data is available, Cockpit shall show total and status-oriented job
   counts.
5. When core system context files are available, Cockpit shall show concise
   previews or freshness metadata for them.
6. When workspace metadata is available, Cockpit shall show a compact file
   summary.
7. When one Overview source fails, Cockpit shall mark only that section as
   unavailable and continue rendering other sections.

### R3. System

System shall help the user understand the context influencing Hermes.

Acceptance criteria:

1. When an observable system prompt is available, Cockpit shall show the prompt
   snapshot used by the most recent eligible conversation, clearly labeled with
   its session/time provenance.
2. When `MEMORY.md` or `USER.md` is available under the resolved Hermes home,
   Cockpit shall show a read-only preview of each file.
3. When `SOUL.md` or `AGENTS.md` is available in the approved Hermes workspace,
   Cockpit shall show a read-only preview of each file.
4. When installed skill manifests are available, Cockpit shall list skills
   using safe metadata such as name, description, and path.
5. When tool metadata is available, Cockpit shall list observable tool names
   and categories without exposing tool credentials or private configuration.
6. When model/provider configuration is available, Cockpit shall render only
   explicitly allowlisted fields and shall omit secret-bearing fields and
   files.
7. When a context document is long, Cockpit shall show a server-bounded preview,
   expose its truncation state, and provide in-page search over the loaded
   content.
8. When Markdown or HTML-like content is previewed, Cockpit shall render it in
   a way that cannot execute embedded scripts or active content.

### R4. Conversations

Conversations shall make existing Hermes session history inspectable.

Acceptance criteria:

1. When Conversations first loads, Cockpit shall show the five most recently
   active eligible conversations, where eligible means interactive,
   non-cron-originated, `hidden = 0`, and `archived = 0`.
2. When a conversation is listed, Cockpit shall show its title or safe fallback
   label, last activity time, source/platform metadata when available, and a
   bounded preview.
3. When the user selects a conversation, Cockpit shall show its ordered message
   transcript without modifying the session.
4. When more than five eligible conversations exist, Cockpit shall provide a
   paginated or cursor-based `Show more` mechanism.
5. When a conversation contains tool calls or reasoning fields, Cockpit shall
   not expose hidden reasoning content by default; tool activity may be shown
   only as safe, bounded metadata.
6. When the session store is busy or temporarily unavailable, Cockpit shall
   return a bounded error state rather than hang or retry indefinitely.
7. Cockpit v0.1 shall not require cross-conversation search; when a long
   document or transcript is open, Cockpit shall provide in-page search over
   the content already loaded in that view.

### R5. Files

Files shall expose a read-only explorer rooted at the approved Hermes
workspace `<local-path>/Hermes`.

Acceptance criteria:

1. When Files loads, Cockpit shall show entries only within the approved
   workspace root.
2. When the user navigates directories, Cockpit shall enforce canonical path
   containment and shall not follow a symlink outside the approved root.
3. When an entry is shown, Cockpit shall show its relative path and, when
   available, size and modified time.
4. When the user selects a supported text file, Cockpit shall show a bounded,
   read-only preview.
5. When the user selects a binary, unsupported, or oversized file, Cockpit
   shall show metadata and an explicit unavailable-preview state rather than
   loading it as text.
6. When a file or path is a dotfile or matches a secret/credential exclusion
   rule, Cockpit shall omit it from the normal explorer and shall not send its
   contents to the browser.
7. When a file changes after a listing was loaded, Cockpit shall not write back
   stale content because no write operation shall exist.

### R6. Jobs

Jobs shall expose Hermes cron/background job definitions and recent execution
state without control actions.

Acceptance criteria:

1. When job definitions are available, Cockpit shall list each job's name,
   schedule, enabled/paused state, last run, next run, last status, and a safe
   delivery-target summary when available.
2. When execution history is available, Cockpit shall show bounded recent run
   metadata such as status and timestamps.
3. When job definitions include prompts, scripts, errors, or delivery
   configuration, Cockpit shall expose only an explicit safe subset and shall
   redact or omit credential-like values. Under the v0.1 local trust model,
   endpoint-like text inside an otherwise allowlisted field may remain visible
   to the local user.
4. When a job source is malformed or partially missing, Cockpit shall show a
   source error without preventing other surfaces from loading.
5. While Jobs is visible, Cockpit shall not offer run, pause, resume, edit,
   remove, or create actions.

### R7. Hermes source resolution and adapters

Cockpit shall isolate Hermes-specific schemas behind server-side read adapters.

Acceptance criteria:

1. When Cockpit starts, it shall resolve the active Hermes home/profile using
   Hermes-compatible profile semantics rather than hardcoding `~/.hermes`.
2. When a resolved source path is displayed, Cockpit shall make its provenance
   visible enough to diagnose profile/path mismatches.
3. When an expected source is absent, its adapter shall return a typed
   unavailable result rather than fabricate data.
4. When Hermes adds unrelated fields to a source, Cockpit shall ignore them by
   default rather than exposing them automatically.
5. When a source contains a field whose name indicates a secret (for example
   token, key, password, credential, cookie, or authorization), Cockpit shall
   omit or redact it before serialization to the browser.
6. Cockpit shall not read `.env`, `auth.json`, credential stores, private keys,
   backup credential files, or OAuth token files.
7. Cockpit shall keep UI mock DTO data and synthetic Hermes fixtures separate
   from configured local personal sources so the UI can be developed and tested
   without reading real personal data.

### R8. Failure handling and bounded reads

Cockpit shall remain usable with large, changing, or partially unavailable
local state.

Acceptance criteria:

1. When a list source contains many records, Cockpit shall use bounded queries
   and pagination rather than loading the full source into the browser.
2. When previewing content, Cockpit shall enforce server-side byte/character
   limits before serialization.
3. When a SQLite source remains locked beyond its bounded busy timeout, Cockpit
   shall return an explicit safe busy error. Synchronous file and list reads
   shall be bounded by approved byte and record caps.
4. When local files or databases change between requests, Cockpit shall read a
   fresh snapshot on the next request without maintaining a second canonical
   store.
5. When an unexpected server error occurs, Cockpit shall log a diagnostic that
   does not contain raw secret values or entire conversation/file contents.

### R9. Verification

Cockpit shall be verifiable without mutating real Hermes data.

Acceptance criteria:

1. When automated tests run, adapter tests shall use fixtures or temporary
   read-only copies rather than write to the active Hermes home.
2. Path-containment tests shall cover traversal attempts and symlinks escaping
   the approved workspace.
3. Redaction tests shall cover nested objects, arrays, mixed key casing, and
   common credential field names.
4. API tests shall verify that mutation methods are rejected.
5. UI smoke tests shall verify navigation, five mock-data surfaces, read-only
   status visibility, loading states, empty states, and source-error states.
6. Before v0.1 is accepted, a manual local smoke test shall confirm that main
   database content and timestamps, existing non-empty WAL content and
   timestamps, business records, and non-database source files did not change as
   a result of inspection. Any empty `-wal` or disposable `-shm` coordination
   change shall be recorded separately under the sole R1 exception.
7. If local permissions, backup tooling, or file watchers make SQLite
   coordination sidecars harmful, or before remote or multi-user operation,
   Cockpit shall withdraw the R1 exception until a bit-for-bit read design and
   its verification are accepted.

## Observed source mapping

The local discovery snapshot is documented in `discovery.md`. The intended
mapping is:

| Product data | Candidate source |
| --- | --- |
| Active profile/home | Hermes profile semantics and `HERMES_HOME` resolution |
| Model/provider summary | Safe allowlist from `<SAFE_CONFIG_SOURCE>` |
| Conversations | `<CONVERSATION_STORE>` through private adapter contracts |
| System prompt | `<PROMPT_RECORDS>` with clear provenance |
| Memory/profile | Named private document sources |
| SOUL/AGENTS | Approved workspace root |
| Skills | `<SKILL_MANIFEST_SOURCES>` |
| Jobs | `<JOB_DEFINITION_SOURCE>` |
| Job executions | `<JOB_EXECUTION_STORE>` |
| Files | `<local-path>/Hermes` |

## Confirmed product decisions

1. **Conversation eligibility:** The default list contains interactive sessions
   only. Cron-originated sessions belong on Jobs; hidden and archived sessions
   remain untouched but are absent from the default list. Here, `hidden` is a
   session database flag and is unrelated to hidden files.
2. **System prompt provenance:** System shows the prompt snapshot used by the
   most recent eligible session and labels it with that session and time. It is
   a snapshot, not a product-managed semantic version, and it is not repeated
   inside every conversation.
3. **Interface language:** Navigation labels are English (`Overview`, `System`,
   `Conversations`, `Files`, `Jobs`), dates are locale-aware, and source content
   remains in its original language.
4. **File visibility:** The explorer shows normal workspace files, hides
   dotfiles and known credential artifacts, and shows metadata-only rows for
   unsupported files. File metadata means descriptive fields such as relative
   path, type, size, modified time, and preview availability—not file content.
5. **Search scope:** Cross-conversation search is not required in v0.1. Long
   document and transcript views provide in-page search.

## Release definition

Cockpit v0.1 is complete when the local operator can start the app and inspect the five
surfaces using real Hermes sources, while tests and a manual audit demonstrate
that Cockpit did not mutate Hermes state or expose credential material.
