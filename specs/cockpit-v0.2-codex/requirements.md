# Cockpit v0.2 Codex Integration Requirements

## Status

Requirements and technical design were confirmed by the user on 2026-09-15.
The implementation task plan was confirmed on 2026-09-15. Task 1's synthetic
spike is GO; Tasks 2–9 have completed the fixed panel/browser-contract
foundation, bounded production Codex read boundary, safe Tasks/main-transcript
and Process projections, scoped API/source orchestration, scoped navigation,
and the Codex Tasks, Overview, System, and Files UI. Task 8 passed its
non-browser gate and the user-run 26/26 targeted synthetic browser checks on
2026-09-16. Task 9's Overview, System, and
optional Files UI is complete: its full non-browser gate passed, and the
user-run isolated browser gate passed 29/29 checks on 2026-09-17
(`legacy-ready` 12/12, `dual-ready` 16/16, and `dual-codex-unavailable` 1/1).
Task 10's Git/PR/remote Verify acceptance and Task 11's real-source acceptance
have not started. The user approved the
actual-empty-placeholder correction and narrower
outbound-deny verification on 2026-09-15; see the
[sanitized spike report](spike-report.md).

## Product statement

Cockpit v0.2 shall let one trusted local operator inspect more than one
configured personal Agent from the same local application. Hermes and Codex
may coexist, while each browser view remains scoped to one explicitly selected
Agent panel.

The release shall extend the existing read-only product without turning
Cockpit into an Agent controller, data warehouse, plugin platform, or remote
service.

## Primary user and job

The primary user is one trusted local operator who already uses Hermes, Codex,
or both on the same machine.

The core job is:

> Reopen Cockpit directly in the Agent I used last, switch Agent only when I
> choose to, and inspect that Agent's supported context and history without
> changing either Agent.

## Definitions

- **Agent panel**: a server-configured, allowlisted observation target with a
  stable ID, display name, runtime kind, supported surfaces, and any explicitly
  approved local roots.
- **Active Agent**: the Agent panel selected by the current browser view.
- **Runtime kind**: the built-in implementation used to read an Agent. v0.2
  supports only `hermes` and `codex`.
- **Supported surface**: an Overview, System, history, Files, or Jobs page
  derived by the server from the panel's built-in runtime kind and explicitly
  approved roots. The history surface is labeled `Conversations` for Hermes and
  `Tasks` for Codex. It is not a browser-configurable capability.
- **Project label**: a bounded, non-path display hint derived from the final
  safe path segment of a Codex task's trusted recorded working-directory
  metadata. It helps identify work context but is not a stable Codex Project
  ID, a Files permission, or a project hierarchy.
- **Current guidance**: guidance files observable now. It is not proof of the
  exact instructions used by a historical task.

An Agent panel is the user-facing object. A panel may read several internal
sources, but those implementation sources shall not appear as separate Agents.

## User stories

1. As a returning user, I want Cockpit to reopen the Agent I used last so that
   routine inspection does not require an extra selection step.
2. As a user of both Hermes and Codex, I want a persistent Agent switcher so
   that I can deliberately change the whole panel's data scope.
3. As a Codex user, I want to inspect recent local tasks, their safe
   conversation content, and the observable work process without resuming a
   task or calling a model.
4. As a Codex user, I want every task to identify its project context, or state
   that it is unknown, so that tasks from different codebases remain
   recognizable.
5. As a Codex user, I want to inspect current, verifiable guidance files while
   understanding that they may differ from a historical task's context.
6. As a security-conscious user, I want each Agent's IDs, requests, files, and
   failures isolated so that content can never silently cross panels.

## Scope

### In scope

- Hermes and Codex Agent panels configured at the same time.
- A browser-local last-Agent preference that avoids a startup selection page.
- A persistent Agent identity and switcher in the application shell.
- Agent-scoped routes, API requests, IDs, cursors, and safe DTOs.
- Capability-aware navigation and direct-route failure behavior.
- Codex Overview, System, and Tasks, using the shared internal history
  capability without presenting development work as chat.
- An always-visible `PROJECT / <label>` or `PROJECT / UNKNOWN` state on every
  Codex task summary.
- A default-collapsed, bounded Process view for safe progress, plan, command,
  tool, and file-change evidence within a Codex task.
- Codex Files only when that panel has an explicitly approved workspace root.
- Existing complete Hermes behavior without regression.
- A server-only, allowlisted Codex read integration with bounded failure and
  source immutability evidence.

### Out of scope

- A mandatory Agent-selection landing page.
- Restoring a specific page, conversation, search term, or scroll position on
  a normal fresh launch.
- Showing data from multiple Agents together on one page.
- Cross-Agent search, timelines, analytics, migration, or deduplication.
- Browser creation or editing of Agent panels, paths, or runtime configuration.
- Dynamic adapters, third-party runtime plugins, or a public adapter SDK.
- Codex task creation, resume, fork, steer, archive, delete, compact, rollback,
  command execution, review execution, or message submission.
- Codex Jobs.
- A Codex Project registry, Project page, Project picker, grouping, filtering,
  per-Project pagination, repository discovery, or inference from Git remotes.
- Claims that current guidance, configuration, skills, or tools exactly
  reproduce a historical Codex task's effective context.
- Direct browser passthrough of raw Codex protocol objects, hidden reasoning
  content, unbounded command output or patches, unrestricted tool or MCP
  arguments and results, raw configuration, hidden instructions, account or
  authentication data, or credentials.
- ChatGPT, Claude, Claude Code, OpenClaw, or Pi integration.
- Authentication, remote access, cloud hosting, or multi-user operation.
- A second application database, background synchronization service, watcher,
  or global full-text index.

## Functional requirements

### R1. Configured Agent panels

Cockpit shall recognize a bounded set of server-configured Agent panels.

Acceptance criteria:

1. When local configuration defines both Hermes and Codex panels, Cockpit
   shall make both available from one running local application.
2. When an existing user provides only the current Hermes configuration,
   Cockpit shall form one Hermes panel and preserve v0.1 behavior.
3. v0.2 shall support at most one Hermes panel and one Codex panel in the same
   process. Additional instances and runtime kinds shall remain unsupported
   until a real need demonstrates value beyond this two-panel contract.
4. When a panel is configured, Cockpit shall require a unique, stable,
   non-path-like ID, a safe display name, a built-in runtime kind, and only the
   panel-specific roots required by its supported surfaces.
5. Configuration may name at most one default panel, and that ID must identify
   a configured panel.
6. When configuration contains a duplicate ID, an unknown runtime kind, an
   unsafe root, or an invalid structural shape, Cockpit shall reject the
   configuration before serving requests rather than guess or reuse another
   panel's source.
7. When a structurally valid panel later lacks its runtime, has an incompatible
   runtime version, or has a temporarily unreadable source, Cockpit shall mark
   only that panel or source unavailable and shall keep other panels usable.
8. Cockpit shall not expose a browser API for creating panels, supplying
   executable paths, or registering adapters.
9. When panel summaries are sent to the browser, Cockpit shall include only
   safe IDs, names, runtime kinds, static configuration state, and supported
   surfaces; it shall omit roots, persistence mappings, commands, credentials,
   and unrequested live source probes.

### R2. Startup and last-Agent preference

Cockpit shall reopen without forcing the user through an Agent picker.

Acceptance criteria:

1. When a user opens an explicit Agent-scoped URL, Cockpit shall use the Agent
   in that URL regardless of the stored last-Agent preference.
2. When a user opens the application root and a valid last-Agent preference
   exists, Cockpit shall open that Agent's Overview without another click.
3. When no last-Agent preference exists, Cockpit shall use the explicitly
   configured default; when no explicit default exists and Hermes is
   configured, it shall use Hermes for backward compatibility.
4. When no preference exists and only one panel is configured, Cockpit shall
   open that panel directly.
5. When the remembered panel no longer exists, Cockpit shall use the same
   deterministic default rule rather than interpret the stale value as
   configuration.
6. When the remembered panel still exists but is unavailable, Cockpit shall
   remain on that panel and show its failure instead of silently switching to
   another Agent.
7. When the user selects an Agent, Cockpit shall persist only its opaque panel
   ID in browser-local preference state; it shall not create an application
   database or persist a path, label, conversation, or source content.
8. A fresh launch shall restore only the last Agent and shall enter its
   Overview; it shall not automatically reopen a specific conversation or
   restore search and scroll state.
9. The last-Agent preference shall be shared by tabs in the same browser
   profile. The most recently completed successful top-level navigation to an
   Agent-scoped page shall replace it; this preference change shall not
   navigate an already Agent-scoped tab.
10. When a new tab subsequently opens the application root, it shall use the
    latest shared preference while every existing tab continues to use the
    Agent in its own URL.
11. Switching, following a direct link or bookmark, and refreshing an explicit
    Agent-scoped page shall update the shared preference only after the panel
    and capability are successfully validated. API calls, prefetching, and
    background data reads shall never update it.

### R3. Agent identity and switching

The application shell shall make the active data scope visible and switchable.

Acceptance criteria:

1. While any panel page is visible, the shell shall display the active Agent's
   name and runtime kind alongside the persistent read-only status.
2. When two panels are configured, the shell shall expose one keyboard- and
   pointer-accessible Agent switcher without showing a mandatory startup page.
3. The switcher shall live with the application identity in the navigation
   rail on wide screens and in the equivalent global navigation area on narrow
   screens; it shall not be styled as a page-specific action.
4. When only one panel exists, the shell shall show its identity without
   rendering a redundant selection control.
5. When the target Agent supports the current surface, switching shall retain
   only the surface type, such as Hermes `Conversations` to Codex `Tasks`. It
   shall not carry the prior Agent's history ID, cursor, selection, search, or
   other page-local state into the target panel.
6. When the target Agent does not support the current surface, switching shall
   open that Agent's Overview and explain that the prior surface is not
   supported.
7. When one tab switches Agent, another tab already displaying a different
   Agent shall remain on its Agent-scoped URL and data.
8. Cockpit shall not keep a mutable process-wide `currentAgent`; active Agent
   identity shall be resolved independently for each request.
9. Selecting an Agent shall update the preference for future root-page opens
   but shall not navigate or rewrite other open tabs.
10. Rendering the switcher shall not trigger background reads of every panel's
    conversations, files, system sources, or databases.
11. The switcher shall not label an inactive panel `Ready` or `Unavailable`
    unless that state comes from a separately approved, bounded, side-effect-
    free probe. In v0.2, live availability is checked only after a panel becomes
    active.

### R4. Agent-scoped routing and isolation

Every panel request shall be explicitly and verifiably scoped.

Acceptance criteria:

1. Except for the legacy single-Hermes compatibility entry points in criterion
   9, every panel page and data API request shall carry a stable panel identity
   that the server resolves through its fixed allowlist. A legacy request shall
   be internally bound to the only configured Hermes panel before any reader
   runs.
2. When a panel ID is unknown, malformed, or no longer configured, the server
   shall reject it and shall not fall back to Hermes, Codex, or the first panel.
3. When Codex is active, Cockpit shall not read Hermes homes, manifests,
   databases, configuration, or jobs.
4. When Hermes is active, Cockpit shall not start a Codex reader or read Codex
   tasks.
5. When one panel's source fails, Cockpit shall not fill the failed section
   with another panel's data.
6. History-record identifiers and cursors shall be opaque and cryptographically
   bound to their panel; a Hermes token used under Codex, or the inverse, shall
   fail before reaching the runtime reader.
7. When a panel switch makes an earlier asynchronous response stale, the
   client shall not render that response when its bound panel ID differs from
   the panel ID in the current scoped URL at commit time.
8. All panel APIs shall retain strict query validation, `private, no-store`,
   no permissive CORS, and safe diagnostic behavior.
9. In legacy single-Hermes configuration, existing unscoped v0.1 pages and
   data APIs shall retain their current behavior.
10. In multi-panel configuration, an unscoped browser page shall resolve the
    last/default panel and redirect to an Agent-scoped page. An unscoped data
    API shall reject the request rather than infer authority from browser
    preference state.
11. If Process output or patch details are loaded separately, the browser shall
    use an opaque authenticated selector bound to the panel, task, item, detail
    kind, and source version. Raw App Server item IDs, filesystem paths, or
    command text shall never act as selectors; forged, stale, cross-task, and
    cross-panel selectors shall fail before the runtime reader runs.

### R5. Capability-aware navigation

Cockpit shall show only capabilities that are truthful for the active Agent.

Acceptance criteria:

1. When Hermes is active, navigation shall retain Overview, System,
   Conversations, Files, and Jobs.
2. When Codex is active, navigation shall show Overview, System, and Tasks.
3. When a Codex panel has an explicitly approved workspace root, navigation
   shall additionally show Files for that panel.
4. When a Codex panel has no approved workspace root, navigation shall omit
   Files rather than derive permission from a task working directory.
5. Codex navigation shall not show Jobs.
6. When a user directly requests an unsupported page or API, Cockpit shall
   return a clear unsupported-capability state without calling a different
   runtime's reader.
7. An unsupported source shall not be represented as a successful empty state,
   such as `0 jobs`, `0 skills`, or `0 files`.
8. Page titles, accessible names, source labels, and errors shall name the
   active Agent where needed and shall not retain misleading Hermes-specific
   language under Codex.
9. The Hermes/Codex capability matrix shall remain a fixed internal contract,
   not a dynamically loaded plugin interface.
10. The shared internal history capability and `/conversations` route may
    remain stable, but every user-visible Codex surface name, including the
    document title, navigation label, H1, accessible names, and loading, empty,
    and failure copy, shall call the surface `Tasks`; Hermes shall retain
    `Conversations`.

### R6. Codex Overview

Codex Overview shall summarize only facts that Cockpit can verify safely.

Acceptance criteria:

1. When Codex Overview loads, Cockpit shall show the panel name, Codex runtime
   identity, connection state, and observation time.
2. When task data is available, Cockpit shall show a bounded recent-task
   summary, the required `PROJECT / <label>` or `PROJECT / UNKNOWN` state for
   every task, and whether more tasks exist.
3. When current guidance sources are available, Overview may summarize their
   availability but shall not call them a historical system prompt.
4. When an approved Files root exists, Overview may show its existing bounded
   workspace summary.
5. Codex Overview shall not show Jobs counts or other numbers that imply an
   unsupported source was inspected.
6. When one Codex reader fails, Overview shall localize the failure and render
   the other available sections.

### R7. Codex Tasks

Codex Tasks shall expose safe, bounded local development-task history without
resuming a task.

Acceptance criteria:

1. When the supported Codex read interface is available, Tasks shall
   initially show at most five non-archived interactive tasks from the
   explicitly allowlisted `cli`, `vscode`, and `appServer` sources, ordered by
   `recency_at` descending. It shall exclude `exec`, sub-Agent, review,
   compaction, spawned-child, and unknown sources.
2. The page shall identify this as the task history indexed in the Codex state
   database. Because `useStateDbOnly` intentionally avoids scanning JSONL to
   repair metadata, Cockpit shall not claim this is a complete inventory of all
   local Codex history; missing metadata shall remain unknown.
3. When more tasks exist, the existing `Show more` interaction shall page
   forward without duplicates, reordering, or cross-panel items while the
   source is unchanged. When the source changes during pagination, Cockpit may
   require a refresh instead of promising snapshot isolation it does not own.
4. Every task summary shall visibly include `PROJECT / <label>` when a safe
   bounded label can be constructed from the final path segment of the trusted
   recorded working directory, and `PROJECT / UNKNOWN` otherwise. Other absent
   task metadata shall be omitted or shown as explicitly unknown rather than
   invented.
5. A Project label shall be a display hint only. Cockpit shall not expose the
   raw working directory, treat the label as an official Codex Project identity,
   use it for routing, grouping, filtering, deduplication, or Files authority,
   or infer it from Git metadata or additional filesystem discovery in v0.2.
6. When a task identity reaches the browser, Cockpit shall replace the raw
   Codex thread ID and persistence location with a panel-scoped opaque ID.
7. When the user opens a task, the main transcript shall display ordered,
   bounded user text and assistant messages explicitly marked `final_answer`
   without changing task state.
8. Non-text user inputs may appear only as generic placeholders that contain
   no URL, local path, asset identifier, mention target, or embedded payload.
   Messages whose phase is absent shall be omitted unless a version-specific
   audited adapter establishes a safe legacy interpretation.
9. Each terminal turn with observable process items shall offer one
   keyboard-accessible, default-collapsed `Process (N)` disclosure. When a
   final answer exists, the disclosure shall follow it; otherwise it shall
   follow the safe terminal status. `N` shall count the visible timeline rows
   after safe transformation and aggregation, never raw or hidden items or
   second-level output and patch details, so expanding details cannot change it.
10. The Process disclosure shall present one bounded timeline that preserves the
    stable order of authoritative terminal items returned by `thread/read`.
    Item labels may identify Progress, Reasoning summary, Plan, Command, Tool,
    and Changes, but visual categorization shall not reorder the evidence.
    Cockpit shall not replay streaming deltas or present an in-progress snapshot
    as a completed historical result, and shall not require a separate page,
    database, persistent index, setting, or export.
11. Progress may show bounded, redacted assistant messages explicitly marked
    `commentary`. Plan may show only the bounded authoritative completed plan
    text available from `thread/read`; Cockpit shall not invent checklist item
    states from streaming notifications it did not retain. Reasoning may show
    only the official bounded `reasoning.summary`, labeled `Reasoning summary`;
    raw `reasoning.content` and hidden chain of thought shall never reach a
    browser DTO.
12. An authoritative terminal `commandExecution` item may show completed,
    failed, or declined status and, when present, bounded duration and exit
    code. A command preview may be constructed only through an explicit
    positive policy for an audited command family or documented structured
    command action; an unrecognized command shall appear only as `Command`.
    v0.2 shall implement at least one audited command-preview policy and one
    independent safe-output policy. A matching output shall appear only after
    explicit user expansion, as a bounded and redacted excerpt. Cockpit shall
    never pass through unrestricted command text, working-directory or
    environment data, stdout, stderr, or aggregated output.
13. File-change evidence may show add, modify, or delete status, counts, and
    canonical approved-workspace-relative paths. A patch excerpt may appear
    only after explicit user expansion when every affected canonical path is
    inside that panel's approved Files root and passes the existing exclusions,
    containment, redaction, line, and byte limits. Otherwise Cockpit shall show
    only a safe change summary and that details are hidden. When an observed
    patch matches the audited in-root policy, v0.2 shall show its bounded
    excerpt through this path.
14. Tool evidence may show only an allowlisted type, safe tool or action label,
    status, duration, and up to three server-constructed `{ label, value }`
    fields from an explicit positive policy. v0.2 shall implement at least one
    such audited tool-field projection and use the same generic row renderer
    rather than a tool-specific interface. Cockpit shall not generically
    serialize tool or MCP arguments, results, errors, resource URIs, server or
    plugin identifiers, task IDs, media URLs, local asset paths, or unknown
    item payloads.
15. When a process item cannot be transformed safely, Cockpit shall degrade it
    to a generic type, terminal status, and `Details hidden` state rather than
    returning the original payload or failing the entire transcript. Unknown
    item types shall appear only as `Unsupported activity`; repeated hidden or
    unsupported items within one turn may be aggregated into one visible row
    at their first position in the timeline.
16. When any visible transcript or Process text contains credential-shaped
    values, machine paths, terminal escape sequences, or control characters,
    Cockpit shall apply the existing server-side browser-text redaction before
    serialization and render the result as inert text.
17. When a stable `thread/read` response completes within the read-process
    limits, Cockpit shall enforce bounded message and total-text DTO limits and
    separate per-field, per-item, per-turn, array-length, patch, output, and
    total Process limits, with explicit omitted-content status. When the
    protocol cannot return the task within those process limits, Cockpit shall
    return a safe `too large` state; v0.2 shall not depend on experimental turn
    pagination or promise a partial transcript from a truncated JSON response.
18. Search shall remain limited to the currently loaded safe transcript and
    visible Process text. It shall not search hidden or unfetched details and
    shall not fetch or expand them automatically, and shall not create a
    persistent or cross-Agent index.
19. When Codex is missing, incompatible, slow, or malformed, Tasks
    shall return a bounded safe error and shall not retry indefinitely or fall
    back to Hermes.

### R8. Codex System

Codex System shall show current, verifiable runtime and guidance information
without claiming to reconstruct historical effective context.

Acceptance criteria:

1. While Codex System is visible, the page shall state that it shows current
   observable guidance rather than the exact context of a historical task.
2. When runtime information is available, Cockpit shall show a bounded Codex
   version/source summary and shall not expose the Codex home path.
3. At global scope, Cockpit shall inspect at most one non-empty current guidance
   file in the configured Codex home: `AGENTS.override.md` takes precedence and
   otherwise `AGENTS.md` is used. When neither exists, System shall state that
   no global guidance was observed.
4. When an approved workspace root exists, Cockpit shall inspect at most one
   non-empty guidance file at that root: `AGENTS.override.md` takes precedence
   and otherwise `AGENTS.md` is used. It shall render a bounded inert preview
   labeled as current approved-workspace guidance. When neither exists, System
   shall show an explicit not-observed state.
5. Cockpit shall describe these files as guidance observed within approved
   roots, not as a complete reproduction of Codex's root-to-working-directory
   discovery chain.
6. v0.2 System shall not traverse a thread working-directory chain. Its workspace
   guidance view is limited to the approved workspace root described above;
   deeper guidance may be opened only through the separately authorized Files
   surface, without being labeled active or historically effective.
7. `SOUL.md` shall not be presented as a Codex standard. When it is explicitly
   named in server-side panel configuration and its canonical path remains
   inside an approved root, Cockpit shall show it as `Custom guidance` under
   the same bounds. A text reference inside `AGENTS.md` shall never expand
   filesystem authority.
8. Current guidance shall not be labeled as instructions known to have been
   used by a historical task unless the supported Codex read contract provides
   immutable historical provenance for that claim.
9. Codex System shall not return raw configuration objects, configuration
   layers, system/developer prompts, accounts, email, credentials, rate limits,
   MCP servers, apps, plugins, tool definitions, hook commands, or hidden
   runtime state.
10. A System inventory of configured skills and tools is not required in the
    first Codex slice; if added later, it shall be specified and reviewed
    separately and shall not be described as historically used without
    evidence. This does not prevent R7 from showing safe evidence that a tool
    action occurred within a selected historical task.
11. When one System source fails, Cockpit shall mark only that source and keep
    other safe runtime or guidance information visible.

### R9. Panel-scoped Files

Files shall remain an explicit per-panel permission, not an inferred Codex
capability.

Acceptance criteria:

1. When Files is enabled for a panel, all reads shall use that panel's
   server-approved canonical workspace root and the existing exclusion,
   traversal, symlink, size, and inert-rendering controls.
2. When a Codex task reports a current working directory, Cockpit may derive
   only the R7 bounded Project display label from it and shall not grant Files
   access to that path.
3. When two panels have different approved roots, each panel's Files page and
   API shall reject paths belonging only to the other root.
4. When a panel has no approved Files root, its other supported surfaces shall
   continue to work.

### R10. Codex read-only process boundary

Cockpit shall not turn observation into Codex execution or source mutation.

Acceptance criteria:

1. When Cockpit communicates with Codex, it shall use a hardcoded allowlist of
   the minimum documented read protocol and shall never proxy a browser-
   supplied method name or raw parameters.
2. The allowed App Server exchange shall be limited to initialization,
   `thread/list` with state-database-only behavior enabled, and `thread/read`
   without resume or subscription unless a later requirement explicitly
   expands the contract.
3. Cockpit shall start a directly owned child process over `stdio://` only. It
   shall not connect to a daemon, Unix socket, WebSocket, or remote App Server.
4. Initialization shall omit experimental capabilities or set
   `experimentalApi` to false, shall not request attestation, and shall not
   enable MCP elicitation.
5. Cockpit shall accept only responses whose IDs match a pending allowlisted
   request. Unexpected server-initiated requests shall fail the read session;
   Cockpit shall never answer them with approval, credentials, attestation,
   elicited user input, or execution permission.
6. Cockpit shall not invoke task, turn, command, review, filesystem, account,
   login, configuration-write, plugin, app, marketplace, MCP, feedback, import,
   or other execution-capable methods.
7. Reading Codex shall not call a model, start an Agent turn, run a tool, or
   upload source content. The fixed credential-free reader requires no successful
   non-loopback connection. Acceptance proves this under an OS outbound-deny
   test policy; it does not claim zero attempted requests or that production has
   an OS network sandbox. Browser non-loopback requests remain prohibited.
8. If the supported Codex process cannot read while leaving the user's real
   Codex business state unchanged, Cockpit shall isolate the process from the
   real state or fail closed; it shall not weaken the read-only promise.
9. A temporary read environment shall not contain authentication material,
   raw user configuration, plugins, or credentials. Cockpit shall remove its
   owned temporary directory on every controllable success, error, timeout,
   cancellation, and process-exit path, and shall safely reap validated stale
   owned directories on a later startup after an unclean host termination.
10. Process startup, handshake, list, read, resident memory, each protocol
    message, total stdout/stderr, and transcript work shall be bounded. Timeout,
    memory, or output overflow shall terminate only the child process owned by
    Cockpit and return a safe error without parsing a truncated JSON response.
11. Unknown response fields shall be discarded while constructing strict safe
    DTOs; raw protocol responses and errors shall not enter logs or browser
    responses.
12. Any SQLite coordination behavior required to prepare a read snapshot shall
    receive an explicit threat-model review and regression tests before the
    Codex integration is accepted; v0.2 shall not silently broaden the v0.1
    source-side-effect exception.

### R11. Privacy, browser, and local deployment boundary

The existing local privacy and browser controls shall apply to every panel.

Acceptance criteria:

1. Cockpit shall remain loopback-only, single-user, unauthenticated, and
   non-elevated.
2. The shell shall keep a visible `READ ONLY` indicator regardless of Agent.
3. Agent APIs shall construct responses from explicit allowlists and strict
   schemas and shall exclude credentials, raw config, private persistence
   names, and unapproved source fields.
4. Codex APIs shall construct new safe transcript and Process DTOs; original
   App Server item objects, streaming deltas, and unknown fields shall never be
   returned to the browser.
5. Error logs shall contain only safe source IDs, panel IDs, and error codes;
   they shall not contain messages, raw protocol output, paths, thread IDs, or
   credentials.
6. Markdown, HTML-like text, guidance files, command output, patches, and tool
   summaries shall remain inert and shall not execute content or automatically
   load remote resources.
7. Mutation HTTP methods shall remain rejected, and no UI shall offer actions
   that change Hermes, Codex, workspace files, or jobs.
8. The last-Agent preference shall not be treated as authorization; every
   request shall independently validate the selected panel and capability.

### R12. Verification and acceptance

The second runtime shall be proved without reading personal histories in
automated tests or regressing Hermes.

Acceptance criteria:

1. Unit tests shall use a deterministic fake protocol or synthetic Codex
   fixture and shall not read a developer's real Codex history, auth, config,
   plugins, skills, or memory.
2. Integration tests shall configure synthetic Hermes and Codex panels
   together and shall prove that each page and API returns only its panel's
   unique markers.
3. Browser tests shall prove that a returning root-page visit restores the last
   Agent without a selection screen.
4. Browser tests shall prove that the switcher preserves a supported surface,
   falls back to the target Overview for an unsupported surface, and does not
   affect another tab already scoped to a different Agent.
5. Browser tests shall prove that two tabs retain their scoped Agents, the most
   recent explicit selection wins the shared preference, and a later root-page
   visit uses that preference without changing either existing tab.
6. Browser tests shall prove Codex Tasks naming, pagination, task selection,
   the always-visible `PROJECT / <label>` or `PROJECT / UNKNOWN` state,
   transcript search, guidance rendering, unsupported Jobs behavior, optional Files
   behavior, and keyboard expansion and collapse of a Process disclosure.
7. Tests shall reject forged panel IDs, cross-panel history-record IDs, cursors,
   stale responses, arbitrary paths, and non-allowlisted protocol methods.
8. Browser fixtures shall contain separately identifiable safe and forbidden
   process markers. Tests shall prove that safe commentary, completed plan text,
   reasoning summary, an audited command preview and status, a bounded output
   excerpt, an allowlisted tool label and safe field, and approved relative file
   changes appear only in the Process disclosure and only after the required
   expansion. A terminal turn without a final answer shall retain its safe
   status and Process disclosure, and the visible rows and aggregated hidden
   row shall preserve fixture item order. Expanding the outer Process shall not
   automatically expand output or patch details, shall not change `N`, and
   every disclosure shall be keyboard operable and expose its state accessibly.
9. Browser and API responses shall contain none of the synthetic raw reasoning
   content, secret command arguments, unrestricted stdout or stderr, out-of-root
   patch or path, raw tool or MCP argument, result, error, URI or identifier,
   machine-specific path, credential, private persistence, raw configuration,
   or hidden instruction markers placed in fixtures. A patch excerpt shall be
   visible only when its synthetic canonical path is inside the approved Files
   root and it satisfies all content limits.
10. Browser network monitoring shall prove no non-loopback browser requests.
    Separately, the pinned synthetic probe/list/read shall pass under an OS policy
    denying successful outbound networking, with parent and descendant controls
    proving the deny is active. This user-approved verification amendment does
    not establish zero attempted reader requests or continuous production
    enforcement; no elevated Codex or system-protection change is permitted.
11. Automated source-fingerprint tests shall use only synthetic Codex and
    Hermes sources and shall prove that they remain unchanged by observation,
    subject only to an explicitly approved and tested coordination exception.
12. The complete existing Hermes unit, integration, browser, security, and
    production-build gates shall remain green.
13. User-initiated local manual acceptance may compare fingerprints of real
    sources, but it shall never run in CI or save content, paths, raw hashes,
    thread IDs, or credentials in repository artifacts or logs.
14. Manual acceptance shall include opening Hermes, switching to Codex,
    inspecting Overview, System, and Tasks, confirming `PROJECT / <label>` or
    `PROJECT / UNKNOWN` on recent tasks, switching back, reopening
    the root URL, expanding one safe Process disclosure, and confirming that the
    last selected Agent opens directly.
15. Compatibility tests shall prove that legacy single-Hermes page and API
    routes retain v0.1 behavior, while multi-panel unscoped data APIs fail
    rather than guessing a panel.
16. Browser tests shall prove that an explicit scoped URL wins without changing
    another tab and becomes the latest shared preference only after successful
    validation. They shall also prove that a removed stale preference uses the
    deterministic default and a remembered but unavailable panel remains
    selected with a bounded failure.
17. Boundary fixtures shall exceed every Process field, item, turn, array,
    command-output, patch-line, patch-byte, and total-response cap. Tests shall
    verify the exact omitted-content state and prove that oversized Process
    evidence does not suppress an otherwise safe main transcript.
18. If Process details use a separate endpoint, tests shall reject forged,
    stale, cross-task, cross-panel, and wrong-detail-kind selectors before any
    runtime read and shall prove that raw item IDs, paths, and commands are not
    accepted.
19. At least one contract test shall validate the synthetic App Server items
    against a pinned schema for the supported Codex version without reading
    personal data. Self-defined fake objects alone shall not establish protocol
    compatibility.
20. Process-specific adversarial fixtures shall prove that ANSI and control
    characters are removed, HTML-like content remains inert, remote resources
    are not requested, and hidden details do not enter search results.
21. Contract and browser fixtures shall prove that every Codex task summary
    renders either `PROJECT / <label>` or `PROJECT / UNKNOWN`; raw
    working directories, credential-shaped final segments, Git remotes, and raw
    Project identifiers shall remain absent from DTOs and rendered
    output. The label shall not change task order or authorize Files access.

## Design and implementation status

The [confirmed technical design](design.md) resolves routing, preference,
configuration, the isolated read boundary, the exact supported version, safe
Process policies and budgets, and approved-root guidance. The
[confirmed task plan](tasks.md) records the evidence for completed Tasks 1–9
separately from the remaining v0.2 product work. Task 1's approved amendments
and synthetic evidence are recorded in the [spike report](spike-report.md).
The complete integration gate and real-source acceptance retain their own gates.

## Reference basis

- [OpenAI Codex App Server](https://developers.openai.com/codex/app-server)
- [OpenAI custom instructions with AGENTS.md](https://developers.openai.com/codex/guides/agents-md)
- [Cockpit v0.1 requirements](../cockpit-v0.1/requirements.md)
