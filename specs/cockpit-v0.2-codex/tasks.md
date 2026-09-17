# Cockpit v0.2 Codex Integration Implementation Plan

## Status

Requirements and technical design were confirmed by the user on 2026-09-15.
This task plan was confirmed on 2026-09-15. Task 1's synthetic spike is GO;
Tasks 2–9 are complete: the fixed panel/browser-contract foundation, bounded
production Codex read boundary, safe Tasks/main-transcript and Process
projections, scoped API/source orchestration, and URL-authoritative Agent
navigation now have source and synthetic tests. Task 8's Codex Tasks UI passed
its full non-browser gate and the user-run 26/26 targeted synthetic browser
checks on 2026-09-16. Task 9's Overview, System, and optional Files UI is
complete: it passes the full non-browser gate (63 files / 617 tests plus
typecheck, zero-warning lint, and production build), and the user-run isolated
browser gate passed 29/29 checks on 2026-09-17 (`legacy-ready` 12/12,
`dual-ready` 16/16, and `dual-codex-unavailable` 1/1). See the
[sanitized spike report](spike-report.md) for the complete ten-check verdict,
approved minimum amendments, and evidence limits.

## Outcome and execution boundary

One local Cockpit can inspect Hermes and Codex separately, reopen the last-used
Agent without a picker, and show Codex Tasks with a safe Project label and a
default-collapsed Process timeline. Hermes behavior and all source, privacy,
browser, and loopback boundaries remain intact.

Use the public checkout, not the old private-history checkout. Preserve unrelated
changes and the public repository's noreply Git identity. This plan does not
authorize commits, pushes, merges, configuration changes on GitHub, or a release.

Before each task, restate its current user outcome and minimum constraints.
Reuse existing readers, schemas, UI, tests, and the passing spike code. Create a
module only when its implemented responsibility requires it; do not scaffold an
adapter framework or empty infrastructure in advance. Keep tests with the task
that introduces behavior. A failed prerequisite stops its dependents.

Automated work uses synthetic sources only. Never invoke Codex against a real
home for an experiment, run an Agent turn, auto-install or downgrade Codex, repair
or migrate a source, or copy auth/config/plugins. Task 11 is the only real-source
acceptance step and requires a separate user-approved window.

## Tasks

- [x] 1. Prove the isolated Codex read path before adding product UI
  - **Dependency:** none; this is the go/no-go gate for Tasks 2–11.
  - **Completed result:** the user approved the existing empty contained placeholder
    and narrower outbound-deny verification on 2026-09-15. Basic synthetic list
    and stable legacy detail passed, with 412 local tests and build passing. The
    result-based parent-loss checker now matches the confirmed safety properties:
    both PID and process group disappear, the source fingerprint is unchanged,
    no forced cleanup occurs, and only the validated stale directory is reaped.
    The tightened active-backup path passed twice; the historical old-checker
    failure remains recorded as unclassified rather than silently erased.
  - Build a bounded synthetic Codex home and active-WAL database from the exact
    audited Codex CLI 0.145.0 layout. Vendor only the initialize/list/read schema
    fixtures needed for contract tests, with upstream provenance, digest, and any
    required license notice. Do not require or download Codex in CI.
  - Use the exact local binary only with a sterile temporary environment. Prove
    online backup, copied-database rollout-path scrubbing, five-item state-only
    list, one copied-rollout detail, and strict returned task ID/source binding.
  - Exercise fixed-size rollout copying, one restart, and the shared five-second
    helper budget. Append, shrink, replacement, and short-read failures must not
    yield a mixed snapshot.
  - Prove source fingerprints, exact empty-WAL/SHM classification, owned-group
    termination, EOF exit after simulated parent loss, liveness-aware stale
    cleanup, and every process/resource cap specified in design §9–12 and §15.
  - Run the pinned synthetic probe/list/read under an OS outbound-deny test
    policy with parent/descendant negative controls. Do not claim zero attempted
    requests, continuous production enforcement, or equivalence to browser
    monitoring; no elevated Codex or system-protection change is permitted.
  - **Acceptance:** all ten go/no-go checks in design §15 pass; sources remain
    unchanged within the exact coordination exception; the amended outbound-deny
    controls pass and no private value reaches safe output/logs. Record only
    sanitized verdicts, versions, test names, and timings. Missing binary or
    incomplete approved enforcement evidence
    is unverified, not GO. Any failure stops implementation and returns to design
    review; direct real-home access is never the fallback.
  - Reuse the successful implementation in Task 3, not a second experiment stack.
  - _Requirements: R10, R11, R12.1, R12.10–12, R12.19._

- [x] 2. Define fixed panels, scoped contracts, and isolated identifiers
  - **Dependency:** Task 1 GO.
  - **Completed result:** a pure structural registry now supports legacy Hermes,
    Codex-only, and dual fixed panels without filesystem access or runtime probes;
    public summaries expose only the exact capability matrix. Separate strict
    Agent/Codex contracts enforce ISO timestamp output, fixed safe failures,
    project/tool path and credential exclusions, guidance identities, transcript
    and Process budgets, and unfinished-turn isolation. Process-local AES-256-GCM
    task/cursor tokens bind panel, runtime, kind, and adapter version and reject
    non-canonical, forged, cross-scope, wrong-kind, and restart-stale values before
    reads. The legacy Hermes codec remains unchanged. Shared credential detection
    is one client-safe pure policy reused by existing server guards and the new
    contracts. Focused regression passed 116 tests; the final full gate passed
    37 files / 446 tests plus typecheck, lint, and the production build. Final
    scoped security review found no P0/P1/P2 issue. No route, UI, real source,
    repository write, or remote action was added.
  - Implement the fixed Hermes/Codex env-backed descriptors, structural mode
    parser, capability matrix, deterministic default, and safe public summaries.
    Preserve legacy single-Hermes behavior and reject partial/conflicting config.
  - Parse configuration without canonicalization, source reads, or executable
    probes for an inactive panel. Keep roots and executable resolution private.
  - Add strict scoped success/failure contracts and separate Codex browser DTO
    schemas; do not turn Hermes contracts into a mega-optional runtime object.
  - Implement panel/runtime/version/kind-bound opaque task and cursor tokens.
    Reject forged, cross-panel, wrong-kind, and restart-stale tokens before reads;
    legacy unscoped Hermes codecs remain unchanged.
  - **Acceptance:** synthetic/unit cases cover legacy, Codex-only, dual panels,
    invalid config/defaults, no inactive probes, fixed capabilities, strict
    envelopes, safe summaries, and every token rejection. No root, private
    persistence name, raw ID, or credential enters a browser contract.
  - _Requirements: R1, R2.3–5, R4, R5, R11, R12.2, R12.7, R12.15._

- [x] 3. Finish the production snapshot and one-operation reader boundary
  - **Dependency:** Tasks 1 and 2.
  - **Completed result:** the production reader now resolves only the fixed
    executable and source, probes exact Codex CLI `0.145.0`, creates a private
    online snapshot, runs one bounded App Server operation, rechecks the copied
    detail row in a separately bounded helper, and accepts another operation
    only after verified cleanup of its single no-queue slot. Cleanup uncertainty
    permanently fails that reader instance closed until restart. Source main/WAL/SHM
    postflight checks enforce the confirmed coordination exception, and the
    Node startup hook performs bounded, liveness-aware stale cleanup. Protocol,
    timeout, resource, cancellation, tamper, active-WAL, and cleanup cases use
    only synthetic sources. The focused gate passed 11 files / 209 tests; the
    final full gate passed 40 files / 472 tests plus typecheck, lint, and the
    production build. No route, browser DTO projection, UI, real Codex source,
    repository write, or remote action was added.
  - Promote the passing spike into server-only owned temp, snapshot worker,
    version probe, protocol, reader, and frozen limits responsibilities. Reuse
    current canonical/no-follow and SQLite read-only controls.
  - Enforce main/companion ownership, type, size, and source containment; use
    online backup and rewrite only the disposable database. Detail restores
    exactly one copied rollout after scrubbing all query-visible source paths.
  - Implement sterile allowlisted helper/probe/App Server environments, private
    pipe inputs, exact handshake identity, numeric request state machine,
    notification allowlist, fatal UTF-8, output caps, and no raw diagnostics.
  - Enforce hard parent deadlines, the process-group RSS watchdog, one reader
    slot without a queue, abort/EOF termination, and validated stale cleanup.
    Cancellation must never terminate another tab's operation.
  - Align AGENTS/SECURITY with the already confirmed fixed Codex database
    coordination exception; do not broaden it into application write permission
    or claim temporary environment variables provide an OS capability sandbox.
  - **Acceptance:** pinned-schema and deterministic fake-executable tests cover
    success plus protocol drift, wrong identity, server requests, invalid UTF-8,
    oversize/hang/exit, descendants, cancellation, cleanup and active-WAL reads.
    Complete source fingerprints and sanitized logs pass. Task 1 GO alone does
    not mark this task complete.
  - _Requirements: R10, R11, R12.1, R12.7, R12.10–11, R12.19._

- [x] 4. Project safe task summaries and the main transcript
  - **Dependency:** Tasks 2 and 3; pure projector tests may overlap Task 3.
  - **Completed result:** a positive Codex-only projector and thin Tasks service
    now preserve the five-item App Server order, exclude non-interactive and
    spawned-child records, derive only a bounded lexical Project label, and
    expose ordered user text plus exact `final_answer` content with fixed
    non-text and terminal states. Panel-bound task/cursor tokens are validated
    before source access, detail reuses the requested public task token, and a
    list never eagerly reads its first detail. ANSI/control/bidi content,
    credentials, machine paths, incomplete item views, raw identities, and
    unsupported payload fields fail closed or are safely omitted. The 100-turn,
    250-message, per-message, 256 KiB transcript, and 512 KiB DTO limits produce
    structured omission notes. A detail-exchange resource overflow alone maps
    to `source_too_large`; other reader resource failures remain unavailable.
    The focused security gate passed 6 files / 42 tests, and the final full gate
    passed 42 files / 487 tests plus typecheck, lint, and the production build.
    Independent final review found no P0/P1/P2 issue. Process, routes, UI,
    real-source access, repository writes, and remote actions were not added.
  - Construct task summaries from the allowed interactive sources only, in
    recency order, with page size five and at most 25 accumulated items. Preserve
    the documented unknown/absent title, preview, activity, and status rules.
  - Derive `projectLabel` only by bounded lexical projection of recorded `cwd`'s
    final safe segment. Reject the specified root/home, control/bidi, credential,
    and oversized cases; never inspect Git/parents or use a label as authority.
  - Project ordered text-user and exact `final_answer` messages, generic non-text
    placeholders, safe terminal status without a final answer, and the fixed
    in-progress notice. Keep raw thread/turn/item IDs out of the DTO.
  - Enforce independent main-transcript budgets and explicit omitted-content
    notes. No initial Tasks load may eagerly request the first detail.
  - **Acceptance:** exact pinned-schema fixtures cover five-item pagination,
    excluded sources, missing metadata, safe Project/UNKNOWN, no raw cwd, title
    invention or filesystem discovery, ordered transcript, phase/non-text cases,
    terminal/no-final and in-progress turns, and each transcript cap.
  - _Requirements: R4, R7.1–8, R7.16–19, R9.2, R11, R12.7, R12.17, R12.21._

- [x] 5. Project useful Process evidence without a raw payload viewer
  - **Dependency:** Tasks 2–4; pure text policies may overlap Task 4.
  - **Completed result:** terminal Codex turns now expose one ordered, bounded
    Process timeline built only from allowlisted commentary, reasoning summaries,
    completed plans, structured command actions, safe file changes, image views,
    and generic web/hidden evidence. Approved workspace paths are canonically
    proven with existing no-follow identity checks or nearest-existing-ancestor
    checks; raw commands, queries, reasoning content, tool payloads, and protocol
    IDs never enter browser DTOs. Valid list output and inert constructed patch
    excerpts are independently bounded; unsafe near-misses degrade without
    failing the transcript; hidden rows aggregate only when exactly adjacent and
    equal. Field, source, row, task, text, and serialized limits report omissions;
    main messages are budgeted first and survive Process pressure. The focused
    and final full gates passed 43 files / 518 tests plus typecheck, lint, and the
    production build. Independent final review found no P0/P1/P2 issue. No route,
    UI, real-source access, repository write, or remote action was added.
  - Build one terminal-item timeline from safe commentary, completed plan text,
    reasoning summary, and the design's command/tool/change policies. Never
    consume raw reasoning content, streaming deltas, or arbitrary object spreads.
  - Implement the positive structured read/list/search command previews, the
    independent validated listFiles output policy, approved-root add/modify/delete
    paths with bounded inert patch excerpts, and the imageView safe File field.
    Test useful positive cases, not only sensitive-field absence.
  - Reuse approved-root containment for command, output, patch, and tool paths.
    Missing roots, unsafe paths, unknown moves/tools/actions or payloads degrade
    safely; Project labels and recorded cwd never authorize a Files root.
  - Preserve authoritative terminal status and stable order. Aggregate hidden
    rows only for identical adjacent `(label, itemType, status)` tuples; `N`
    counts final top-level rows only. Reserve the main transcript budget first.
  - **Acceptance:** every audited positive policy is visible in the safe DTO;
    near misses and forbidden markers are absent. Mixed types/statuses retain
    order, no-final turns retain Process, all field/item/turn/array/output/patch/
    total caps report omissions, and Process overflow never suppresses safe main
    messages. Safe excerpts ship inside the bounded DTO; no detail endpoint.
  - _Requirements: R7.9–18, R9, R11, R12.8–9, R12.17, R12.20._

- [x] 6. Expose correctly scoped surfaces and localize source failures
  - **Dependency:** Tasks 2–5.
  - Add explicit scoped GET routes and the small service runtime switch; validate
    panel/capability/token/query before opening a source or starting a child.
    Preserve legacy naked DTOs; scoped-mode unscoped APIs return panel_required.
  - Scope existing Hermes surfaces and Files readers by resolved private roots,
    without duplicating their adapters or weakening v0.1 path/security guards.
    Codex Jobs and System/context reject before parsing detail/path inputs.
  - Add direct bounded current-guidance readers with override/base precedence,
    empty behavior, deduplication, custom relative guidance and scoped failures.
  - Implement Codex Overview's strict four-section snapshot. Its single list
    operation supplies the runtime probe result; guidance/workspace settle
    independently and never self-contend for the Codex reader slot.
  - **Acceptance:** synthetic HTTP tests prove correct panel markers across all
    surfaces, legacy/scoped contracts, unsupported-before-read, different Files
    roots, missing-root independence, safe System provenance and precedence,
    Overview local failure, one-operation orchestration, headers/GET-only/query
    rules, and no private markers in responses or logs.
  - _Requirements: R4–6, R8–11, R12.2, R12.7, R12.9–11, R12.15._
  - **Completed result:** eight explicit panel-scoped GET APIs now dispatch only
    to the resolved fixed runtime while legacy single-Hermes APIs retain their
    naked DTOs. Hermes roots, Codex current guidance/System/Overview, Files,
    localized failures, browser-safe text, and worker trace inputs are covered
    by synthetic tests. `pnpm verify` passed TypeScript, lint, 54 test files / 589
    tests, and the production build; final security, contract, and ablation
    reviews reported no remaining P0/P1/P2. No real Agent source was opened.

- [x] 7. Add scoped navigation and remember the last Agent without a picker
  - **Dependency:** Tasks 2 and 6.
  - Read the installed Next.js 16 routing/layout/metadata/cookie/prerender guides
    before touching application structure. Retain awaited connection(), async
    params/cookies, the neutral root document, and legacy single-Hermes layout.
  - Add scoped pages and capability validation, runtime-specific titles/Tasks
    copy, the single-panel mark or two real Agent links, and no inactive prefetch.
    Remove the Hermes stamp from the shared scoped shell only.
  - Implement URL-authoritative scope and validated last-panel cookie commits
    after successful page/capability resolution. Restore Overview on fresh root
    launch and preserve only a supported surface on an explicit switch.
  - Parse scoped client envelopes, abort stale requests, and verify panel identity
    at commit time. Keep selection/cursor/search state local to each scoped page.
  - Keep switch focus and one polite scope/fallback announcement; adapt sticky
    shell height/focus offsets using existing design tokens, not a new shell.
  - Before browser acceptance, extend the existing synthetic browser runner for
    separately isolated legacy and dual-panel fixture servers, sequentially
    where configuration differs. Explicitly blank unused source env keys so
    ignored .env.local cannot reintroduce real sources; never reuse an already
    running localhost server. Tasks 7–9 use this same safe runner for focused
    checks, not production mock modes or independently improvised servers.
  - **Acceptance:** component/integration and targeted synthetic browser tests
    prove URL/default/stale/unavailable rules, successful-navigation-only cookie
    updates, independent tabs, supported/fallback switching, no stale responses,
    no inactive reads, keyboard focus, and 320/390 navigation. A no-source build
    regression fails if a reader is invoked during prerender.
  - _Requirements: R1–5, R11, R12.3–7, R12.12, R12.15–16._
  - **Completed result:** the neutral root and legacy Hermes layout now coexist
    with five explicit Agent-scoped pages, capability-aware navigation, truthful
    Codex `Tasks` naming, URL-authoritative scope, and a validated last-panel
    cookie written only after a supported leaf page mounts. Two real Agent links
    preserve supported surfaces, fall back to Overview with one bounded notice,
    disable prefetch, and use a same-tab one-shot marker so only an actual switch
    receives focus and a polite announcement. Scoped Hermes clients validate
    panel envelopes, abort superseded reads, and reject old-panel responses at
    commit time. The existing browser runner now executes isolated legacy-ready,
    dual-ready, and dual-Codex-unavailable fixtures on separate random ports,
    explicitly clears every unused source variable, never reuses localhost, and
    verifies unchanged Hermes/Codex source fingerprints. Final gates passed
    TypeScript, lint, 59 test files / 602 tests, the guarded no-source production
    build, and 23/23 browser checks including 320/390 navigation and skip-link
    offsets. Independent final review found no remaining P0/P1/P2. No real Agent
    source, repository write, remote action, or release was used.

- [x] 8. Let users inspect Codex Tasks, Project labels, and folded Process
  - **Dependency:** Tasks 4–7.
  - Reuse the index/transcript/ledger layout with Codex-only contracts and visible
    Tasks naming. Start at list plus Select a task; implement Show more, selected
    detail, bounded loading/error/empty/refresh states, and safe metadata.
  - Display PROJECT / label or PROJECT / UNKNOWN below every task title and in
    the selected ledger. Keep it non-interactive and the list globally ordered.
  - Render one native default-closed Process disclosure per eligible terminal
    turn and a stable chronological timeline. Output/patch use a second native
    disclosure only; no modal, third level, raw JSON, copy/export, or filters.
  - Search only the loaded main transcript and presently visible safe Process
    text; disclosure changes update match counts but search never opens details.
  - **Acceptance:** component and targeted browser flows prove an initial
    list-only state with no eager detail read, pagination, selection, rejection
    of superseded same-panel detail responses, Tasks wording and Project
    labeling, known/UNKNOWN/long labels, no-final Process, positive command/
    output/tool/patch evidence, hidden degradation, stable N, keyboard disclosure
    state, and visible-only search. At 320/390/desktop labels remain accessible
    exactly once; narrow disclosure targets are 44px and no content/focus is
    hidden under the sticky shell or spills the page width.
  - _Requirements: R5, R7, R11, R12.6 Tasks-only, R12.8–9, R12.17,
    R12.20–21._
  - **Completed result:** the dedicated Codex Tasks client, folded Process renderer,
    strict scoped failure handling, read guards, synthetic detail/pagination
    fixture, and focused component/browser specifications are implemented. The
    full non-browser gate passes TypeScript, zero-warning lint, 60 test files /
    611 tests, and the production build. The user-run isolated browser gate passed
    26/26 checks across legacy-ready, dual-ready, and dual-Codex-unavailable on
    2026-09-16, including the desktop, 320px, and 390px Codex Tasks flows. No real
    Agent source was opened.

- [x] 9. Complete truthful Codex Overview, System, and optional Files UI
  - **Dependency:** Tasks 6 and 7; may overlap Task 8 on non-overlapping files.
  - **Completed result:** the four-section Codex Overview, path-free current-guidance
    inspector, and panel-rooted Files page are implemented. Focused component
    checks cover Project/UNKNOWN rows, partial failures, guidance states, inert
    search, metadata-only files, and empty directories. The complete non-browser
    gate passes 63 files / 617 tests plus typecheck, zero-warning lint, and the
    production build. The user-run isolated browser gate passed 29/29 checks on
    2026-09-17: `legacy-ready` 12/12, `dual-ready` 16/16, and
    `dual-codex-unavailable` 1/1. No real Agent source was opened.
  - **Overview:** show runtime/observation, five recent Tasks each with Project
    metadata, current-guidance states, and explicitly configured workspace.
    Independently render empty/unavailable/error; never show fake Jobs zeroes.
  - **System:** reuse the inspector for path-free current global/workspace/custom
    guidance, bounded inert preview/search and explicit source states. State the
    historical-context and discovery-chain limits; SOUL is Custom guidance.
  - **Files:** reuse the current browser through its scoped API/root. Omit Files
    without permission and retain unsupported direct-route behavior; do not
    infer permission from any task or Project label.
  - **Acceptance:** each surface has its own synthetic component/browser result:
    Overview Project rows and partial failure; System precedence, current-only
    wording, search and inert content; optional Files/root isolation and empty/
    metadata-only preview. Codex titles/errors never inherit Hermes-specific
    context, and existing Hermes pages remain unchanged.
  - _Requirements: R5–6, R8–9, R11, R12.2, R12.6, R12.9, R12.21._

- [ ] 10. Prove the complete integration in the existing verification gate
  - **Dependency:** Tasks 1–9 and their focused checks.
  - Run the complete legacy and dual-panel suites through the isolated synthetic
    runner accepted in Task 7. Retain its source-env clearing and fixture-server
    separation; do not add production mock modes or reuse a live local server.
  - Cover switching/restoration/two tabs, all surfaces, positive and forbidden
    Process markers, no-final turns, stale data, unsupported Jobs/Files, Project
    labels, keyboard focus and 320/390/desktop. Keep tests web-first without sleeps.
  - Monitor console/page errors, browser requests and relevant response bodies;
    assert forbidden markers absent, inert HTML, no non-loopback requests, and
    complete synthetic source fingerprints unchanged within the exact exception.
  - Retain the full legacy unit/integration/browser/security/read-only/build
    coverage and existing GitHub Verify workflow; add no second CI/matrix gate
    merely to separate the runtime. CI uses fake Codex plus pinned contracts.
  - After local gates pass, request separate permission to commit, push, and open
    the change PR if not already explicitly authorized. Observe its remote
    Verify result before completing this task or beginning Task 11; plan
    confirmation does not grant those repository-write permissions.
  - **Acceptance:** full pnpm verify, pnpm test:browser and the existing required
    GitHub Verify check pass without skipped/suppressed failures. Record exact
    versions/commands/results and distinguish pinned-real-binary local evidence
    from fake-binary CI and browser-network evidence. Do not claim current CI or
    Codex automatic review succeeded before observing it on the real change PR.
  - _Requirements: R12, with regression coverage for R1–11._

- [ ] 11. Accept real local behavior and prepare an honest v0.2 handoff
  - **Dependency:** Task 10 and a separately user-approved real-source window.
  - Update README/SECURITY and spec implementation notes with fixed env setup,
    exact Codex version/Unix support, optional Files/custom guidance, source-index
    completeness, Project-hint limits, supported Process policies, safe errors,
    temporary-history crash residue, and the precise coordination exception.
  - Give the user plain-language manual steps: Hermes → Codex → Overview/System/
    Tasks + Project labels → one Process/nested detail → Hermes → root reopen.
    Ask for semantic/privacy/visual confirmation; automation cannot replace it.
  - Compare real-source fingerprints in an approved quiet window without saving
    paths/content/raw hashes/history IDs or screenshots/HAR to the repository.
    Concurrent writer changes are inconclusive, not attributed to Cockpit or
    Hermes without evidence; unexplained source mutation blocks acceptance.
  - Start local service normally; after the first clear bind/sandbox/proxy failure
    stop and give the user the project directory, startup command, loopback URL,
    and localhost/127.0.0.1/::1 proxy bypass. Do not automate a workaround service.
  - **Acceptance:** user confirms the visible flows/data/privacy, source results
    are acceptable and honestly scoped, full CI remains green, and docs match the
    implemented behavior. Only then mark v0.2 accepted. Version/tag/release and
    publication are separate actions requiring an explicit user request; no npm,
    cloud, multi-user, or other runtime support is implied.
  - _Requirements: R1–12, especially R12.12–14._

## Review and completion rules

Each meaningful unit receives a scoped diff review and its focused tests before
dependents rely on it. Record implemented, observed, and unverified separately.
Only actual completed work earns a checkbox; a specification, fixture, or passing
spike does not by itself prove a user-visible feature.

Tasks 1–9 are complete. Tasks 8 and 9 passed their targeted synthetic browser
gates, and Tasks 6–9 use only safe fixtures while preserving the scoped read
and privacy boundaries.
Do not parallelize overlapping
shell/routes/contracts edits or claim a dependent task complete before its
accepted prerequisites are complete.

The confirmed design's deferred conditions remain deferred: Project grouping,
more Codex versions, more runtime instances, OpenClaw/Pi/Claude, a setup wizard,
reader reuse, generic raw-process viewing, remote/multi-user mode, and a hard OS
sandbox. They are not hidden sub-tasks of this release.

## Execution gate

The user has confirmed this plan. Task 1 has earned GO after all ten amended
go/no-go checks passed, and Tasks 2–9 have completed their scoped contract,
reader, safe main-transcript, safe Process, scoped API/source, and navigation
boundaries plus the Codex Tasks/Overview/System/Files UI and their 26/26 and
29/29 targeted browser checks.
Real-source acceptance and repository writes retain their separate authorization
gates.

References: [requirements](requirements.md), [confirmed design](design.md).
