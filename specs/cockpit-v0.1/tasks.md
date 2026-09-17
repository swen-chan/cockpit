# Cockpit v0.1 Implementation Plan

## Status

Confirmed on 2026-08-28. Tasks 1–14 are complete. Cockpit v0.1 passed its
production build, deterministic Chromium CI gate, and final real-source
read-only acceptance on 2026-09-12.

## Execution rules

- Complete tasks in order unless a task explicitly states that work can be
  parallelized.
- Keep each checkbox current as implementation progresses.
- Verify each task's named checks before marking it complete.
- Use synthetic fixtures and UI mock DTO data until the read-only security
  foundation and its tests pass.
- Never write to Hermes state or the approved Hermes workspace.
- Do not add an application database, remote service, analytics, authentication,
  mutation controls, Projects, messaging, or automation.
- When first starting the local server, use the normal repository command. If
  the first clear attempt cannot bind its localhost port because of sandbox,
  permissions, or proxy behavior, stop and provide the user with the project
  directory, exact command, local URL, and proxy-bypass note for `localhost`,
  `127.0.0.1`, and `::1`.

## Tasks

- [x] 1. Initialize the local Next.js repository and quality baseline
  - Scaffold Next.js App Router with React, TypeScript, Tailwind CSS, `src/`
    layout, pnpm, and the package-managed IBM Plex fonts.
  - Preserve the existing `specs/` documents and initialize Git without
    publishing or configuring a remote.
  - Add scripts for development, build, lint, typecheck, unit/integration tests,
    and browser tests.
  - Add the approved dependencies from `design.md`, then verify
    `better-sqlite3` installs and loads under the local Node runtime before
    building adapters around it.
  - Configure strict TypeScript; do not introduce `any`, type suppression, or
    broad lint disables.
  - Add a concise README with the local-only/read-only product boundary and the
    intended loopback URL.
  - Verify the initial typecheck, lint, test harness, and production build.
  - _Requirements: R1, R9_

- [x] 2. Implement the industrial UI foundation and shared shell
  - Define the approved color, typography, spacing, border, focus, and motion
    tokens in one theme layer.
  - Add selected shadcn/ui primitives and Lucide icons without importing a
    generic dashboard template.
  - Build the asymmetric navigation rail, page header, persistent `READ ONLY`
    strip, profile/source stamps, and responsive provenance ledger.
  - Add shared loading, empty, unavailable, error, truncation, metadata-row,
    table, and preview components.
  - Create the five routes with the confirmed English navigation labels and
    accessible landmarks.
  - Verify keyboard navigation, focus visibility, reduced-motion behavior, and
    wide/medium/narrow shell layouts with fixture content.
  - _Requirements: R1, R2, R3, R4, R5, R6, R9_

- [x] 3. Define browser-safe contracts, fixture sources, and mock surfaces
  - Add strict source-stamp contracts and safe DTOs for
    profiles, system context, conversations, files, jobs, and Overview.
  - Validate unknown fixture/source input with narrow schemas and type guards.
  - Implement mock adapters matching the future local-adapter interfaces.
  - Populate realistic synthetic fixtures without copying personal Hermes
    content.
  - Complete all five surfaces against mocks, including normal, empty,
    unavailable, malformed/error, and truncated states.
  - Verify navigation, selection, `Show more`, and in-page search in a browser
    before connecting real sources.
  - _Requirements: R2, R3, R4, R5, R6, R7, R8, R9_

- [x] 4. Build and test the read-only source/security foundation
  - Implement per-request Hermes context resolution for explicit home,
    `HERMES_HOME`, sticky default/named profile, missing profile, and custom
    profile cases.
  - Canonicalize the fixed workspace root and implement relative-path parsing,
    `realpath` containment, symlink escape prevention, and dot-path exclusion.
  - Add credential filename rules, allowlist builders, recursive redaction as a
    secondary defense, safe error codes, content byte/character limits, and
    sanitized diagnostics.
  - Add server-only boundaries so filesystem/SQLite modules cannot enter client
    bundles.
  - Implement read-only SQLite connection helpers with file-must-exist and
    bounded busy timeout settings.
  - Unit-test traversal, encoded path, NUL-byte, symlink, secret-name, nested
    redaction, profile mismatch, missing source, and busy-source cases.
  - Do not enable real local adapters until these tests pass.
  - _Requirements: R1, R5, R7, R8, R9_

- [x] 5. Connect safe profile, model/provider, and system-context sources
  - Implementation note (2026-09-01): the real adapters, private ignored
    source manifest, strict browser DTOs, bounded Markdown rendering, prompt
    hash/fallback resolution, and synthetic/real read-only verification are
    complete. The SQLite adapter follows SQLite/Datasette-style direct
    read-only transactions instead of copying the full live database per
    request. Typecheck, lint, 101 automated tests, and the production build
    pass. In-document search and real System Prompt content/provenance passed
    user acceptance on 2026-09-04.
  - Parse `<SAFE_CONFIG_SOURCE>` server-side and build a new summary object from an
    explicit field allowlist.
  - Expose resolved profile, Hermes home, model/provider identifiers, and safe
    configuration status without base URLs, environment references, headers,
    extra bodies, or authentication state.
  - Add named adapters for Memory, User Profile, SOUL, and AGENTS with bounded
    reads and source provenance.
  - Select the System Prompt snapshot from the most recent eligible session,
    join/fallback safely by prompt hash, and label it with session/time
    provenance.
  - Render Markdown without raw HTML or remote images; render HTML source only
    as escaped text.
  - Add fixture integration tests for available, missing, oversized, invalid,
    and concurrently busy sources.
  - _Requirements: R2, R3, R7, R8, R9_

- [x] 6. Connect Skills, Tools, and Providers views
  - Implementation note (2026-09-06): real skill discovery, safe frontmatter,
    CLI toolset status with configuration explanations, provider summary,
    compact skill drill-down, selected-body search, and opaque-ID skill body
    loading are implemented. Automated and real-source verification pass.
    Browser acceptance passed on 2026-09-08, including filtering, bounded
    detail loading, selected-body search, provenance, and narrow layout.
  - Discover skills only from allowed non-dot directories containing
    `SKILL.md`; list safe frontmatter and load bounded bodies on demand.
  - Represent tools as configured Hermes toolsets with effective status, using
    only safe plugin-toolset names as augmentation.
  - Do not infer enabled tools by scanning implementation files.
  - Render the provider summary from the config allowlist and prove with tests
    that credential-bearing fields never reach DTOs or rendered output.
  - Add filtering and in-page search for the loaded skill/tool rows.
  - Verify large skill collections remain bounded and responsive.
  - _Requirements: R3, R7, R8, R9_

- [x] 7. Connect eligible Conversations and transcript inspection
  - Implementation note (2026-09-07): real eligible-session queries, opaque
    keyset pagination, bounded transcript loading, safe tool-activity labels,
    metadata, `Show more`, and transcript search are implemented. Automated
    tests and a direct real-source read-only audit pass. Browser acceptance
    passed on 2026-09-08, including selection, pagination, transcript search,
    provenance, console health, and narrow layout.
  - Implement the bounded session query ordered by last activity and ID.
  - Exclude cron-originated, `hidden = 1`, and `archived = 1` sessions through
    source/session metadata rather than title heuristics.
  - Add opaque cursor pagination with default limit five and a server-side cap.
  - Implement safe transcript queries for ordered active messages and bounded
    tool-activity labels.
  - Exclude reasoning, raw API content, raw tool payloads, origin JSON, billing
    endpoints, and other internal fields from DTOs.
  - Wire conversation list, selection, provenance ledger, `Show more`, and
    loaded-transcript in-page search.
  - Test stable pagination, equal timestamps, empty sessions, large messages,
    hidden/archived/cron exclusions, and busy database handling.
  - _Requirements: R4, R7, R8, R9_

- [x] 8. Connect the scoped Files explorer and safe previews
  - Implementation note (2026-09-09): bounded real-workspace listings,
    relative-path navigation, conservative preview classification, safe text
    and Markdown rendering, metadata, search, and explicit unavailable states
    are implemented. Automated security/interaction tests and browser
    acceptance pass, including directory navigation, path redaction, console
    health, and a 390px narrow layout.
  - Design note (2026-09-08): keep the workspace root server-defined and accept
    only validated relative paths from the browser. Reuse canonical containment,
    exclusion-before-open, and pinned-descriptor reads; bound both directory
    results and raw entries scanned. Do not add recursive tree loading, direct
    file serving/iframes, persistent indexes, copied snapshots, or encrypted
    file IDs. Fresh preview reads return fresh metadata, so a version-lock layer
    adds no value while no write path exists.
  - Implement bounded, sorted directory listings rooted only at
    `<local-path>/Hermes`.
  - Omit dotfiles and credential artifacts before opening file content.
  - Detect text, binary, unsupported, and oversized files conservatively.
  - Return safe metadata for every visible entry and bounded text previews only
    for approved content.
  - Wire directory navigation, metadata ledger, preview states, and in-page
    search without exposing absolute-path request parameters.
  - Test traversal, symlink escapes, hidden paths, credential files, HTML active
    content, binary files, oversized files, 500-entry truncation, and files that
    change between requests.
  - _Requirements: R5, R7, R8, R9_

- [x] 9. Connect Jobs and recent execution state
  - Implementation note (2026-09-09): the live Jobs surface resolves approved
    definition and execution-ledger mappings only from the ignored local source
    manifest, then reads them through bounded, read-only adapters. Browser DTOs
    are rebuilt from an explicit allowlist; prompts, scripts, raw errors,
    recipients, process data, claims, and output remain unselected. Paths and
    endpoint-like text inside allowlisted fields remain visible under the v0.1
    local trust model; credentials are still rejected.
    Definitions survive an unavailable execution ledger through an explicit
    partial-source state. Automated tests and real-source browser acceptance
    pass, including live jobs, per-job execution limits, selection, console
    health, privacy, and a narrow horizontally scrollable table with stacked
    details.
  - Design note (2026-09-09): keep filenames, database tables, and source-field
    mappings in the ignored local manifest. Validate every path and identifier
    before constructing a bounded per-job execution query. Do not read output
    files or materialize a second index: neither adds value to this read-only
    inspection surface.
  - Parse `<JOB_DEFINITION_SOURCE>` as unknown input and narrow each record into the safe
    job DTO.
  - Query bounded recent status/timestamp data from `<JOB_EXECUTION_STORE>` using a
    read-only connection.
  - Include name, schedule, state, safe timestamps, failure streak, profile,
    skills/toolsets, and delivery platform/type only.
  - Exclude prompts, scripts, raw errors, recipient identifiers, process IDs,
    claims, job output, and credential-like values.
  - Wire the jobs table, selected-job provenance, recent execution summary, and
    partial-source error states with no mutation controls.
  - Test missing/malformed JSON, missing execution DB, unusual schedules,
    paused/disabled jobs, failed runs, and secret-like nested fields.
  - _Requirements: R6, R7, R8, R9_

- [x] 10. Compose Overview from the real adapters
  - Implementation note (2026-09-09): Overview now composes profile/config,
    five core System sources, five recent eligible conversations, bounded root
    workspace metadata, and Jobs concurrently through the existing read-only
    services. Each source is projected into a strict compact DTO and owns its
    unavailable/error/empty presentation, so partial failures remain local to
    their section. The loopback UI shows the resolved canonical Hermes home as
    an explicitly allowlisted local path and retains per-source freshness.
  - Design note (2026-09-09): only the profile read shared by the root layout
    and Overview uses React's request-scoped memoization. No persistent cache,
    recursive workspace scan, exact conversation count, retry layer, or second
    store was added. SQLite lock waits already end through the bounded busy
    timeout, and file/directory reads are hard-bounded; a generic Promise timer
    was rejected because it cannot cancel the current synchronous readers.
    A wall-clock timeout should be added only if a source gains a genuinely
    cancellable read mechanism.
  - Build an Overview service that requests profile/config, conversations,
    system context, files, and jobs independently.
  - Show profile/model, recent conversation, system-context freshness, job
    status, and workspace registers from browser-safe DTOs.
  - Preserve successful sections when another source is unavailable, malformed,
    busy, or timed out.
  - Use only in-request memoization; do not add persistent application storage or
    conceal mixed-source freshness.
  - Test every single-source failure and representative multiple-source failure
    combination.
  - _Requirements: R2, R7, R8, R9_

- [x] 11. Enforce the local HTTP and browser security boundary
  - Implementation note (2026-09-10): all eight documented data endpoints now
    expose GET only, validate bounded allowlisted query parameters before source
    loading, validate strict browser DTOs, and return private no-store responses.
    A Next 16 proxy rejects non-loopback Host values, mismatched Origin values,
    and cross-site no-cors browser subresources before routing. Static CSP,
    same-origin resource policy, frame denial, no-referrer, and nosniff headers
    form the browser defense-in-depth layer without permissive CORS. `5xx`
    responses log only a constant source id and diagnostic code.
  - Design note (2026-09-10): the documented System endpoint was retained for
    HTTP-contract completeness even though the current page initially renders
    on the server. Authentication, TLS, a custom server, nonce CSP, SRI,
    Referer/Sec-Fetch general allowlists, and another HTML sanitizer were
    rejected: they add operational or rendering complexity without improving
    this loopback-only, read-only v0.1 boundary. Fetch Metadata is consulted only
    for the narrow Origin-less cross-site no-cors case.
  - Implement the documented GET-only Route Handlers with validated, length-
    capped query parameters and `private, no-store` responses.
  - Verify mutation methods return `405` and no generic absolute-path/source
    endpoint exists.
  - Restrict Host/Origin behavior to the approved loopback application origin,
    omit permissive CORS headers, and add frame/content security headers.
  - Confirm Markdown, transcript, path, and error content cannot inject active
    HTML or trigger automatic remote image requests.
  - Add integration tests that inspect complete JSON responses for forbidden
    fields and credential-like values.
  - _Requirements: R1, R3, R5, R6, R7, R8, R9_

- [x] 12. Refine responsive, accessible, and high-density inspection flows
  - Implementation note (2026-09-10): the narrow shell now keeps all five
    routes visible at 320–390 px, and master-detail flows move focus only when
    their panes are actually stacked. Long previews and the jobs table expose
    named keyboard-scroll regions; pagination, directory changes, and
    directory/file request races preserve stable focus and the latest user
    intent. System timestamps use the established CST formatter, and secondary
    text plus selected failure states meet the confirmed contrast target.
  - Design note (2026-09-10): the existing visual system and native controls
    were retained. The focus-losing Skills auto-collapse was removed, while a
    drawer, custom ARIA widgets, an i18n settings layer, new client state, and
    new dependencies were rejected as unnecessary for v0.1. The full
    route/state/browser verification matrix remains Task 13.
  - Polish wide three-column layouts, medium inline provenance, and narrow
    stacked views across all five surfaces.
  - Verify tables, split panes, directory navigation, transcript roles, status
    labels, pagination, disclosures, and search are keyboard and screen-reader
    understandable.
  - Apply locale-aware dates while keeping source content untranslated.
  - Audit colors, fonts, icons, asymmetry, motion, truncation, and source labels
    against the confirmed UI specification.
  - Verify adjacent routes after every shared-shell or shared-component change.
  - _Requirements: R1, R2, R3, R4, R5, R6, R9_

- [x] 13. Complete automated verification and production build gates
  - Implementation note (2026-09-12): the existing Verify job now appends one
    Chromium run after the production build. A test-only runner creates a
    temporary synthetic Hermes home, injects it before the server starts,
    refuses to reuse a real local server, and verifies source SHA-256 hashes,
    sizes, and modification times before cleanup. Browser flows cover all five
    surfaces, representative selection/search/pagination/file states, narrow
    layouts, active-content isolation, unexpected remote requests, and raw or
    credential marker leakage without adding a production mock mode.
  - Verification evidence (2026-09-12): `pnpm verify` passed with 26 test files
    and 214 tests plus the production build. GitHub Actions passed all 12
    Chromium tests. The first CI run exposed and
    led to a real 320 px Overview overflow fix. This sandbox cannot bind the
    loopback test server, so the runtime browser evidence is the CI run; real
    Hermes acceptance and concurrent-write interpretation remain Task 14.
  - Run the full strict typecheck, lint, unit tests, integration tests, browser
    tests, and production build with no new warnings or suppressed failures.
  - Use browser tests to visit all five routes and exercise representative
    selection, pagination, in-page search, empty, metadata-only, and responsive
    states. Keep unavailable, malformed, and busy source-reader behavior at the
    lower-level unit and integration layers rather than duplicating it in the
    browser.
  - Check browser console and network activity for hydration errors, unexpected
    remote requests, raw source leakage, and credential content.
  - Confirm synthetic business-source files and main databases have identical
    hashes and modification times before and after the test suite. Verify live
    non-empty WAL immutability at the SQLite unit boundary, and classify any
    permitted empty `-wal` or disposable `-shm` coordination separately under
    the R1 exception.
  - Record exact verification evidence and unresolved gaps rather than relying
    on code inspection alone.
  - _Requirements: R1, R2, R3, R4, R5, R6, R7, R8, R9_

- [x] 14. Perform the real-Hermes read-only acceptance audit and handoff
  - Acceptance evidence (2026-09-12): the real-source browser
    technical check passed Overview, System, Conversations, Files, and Jobs with
    the persistent `READ ONLY` boundary and no mutation controls, console
    errors, or active-content elements. Task 13's synthetic Chromium gate
    separately verifies that untrusted content creates no remote requests.
    Representative System selection/search, Conversation selection/pagination/
    search, Files directory/search/metadata-only, and Jobs selection flows also
    passed. A quiet-window repeat compared all approved sources included in the
    audit, the main databases, and existing WAL state before and after the same
    read flows; all were unchanged. An earlier conversation database
    change across the longer inspection window was consistent with concurrent
    Hermes activity and did not recur during the Cockpit-only quiet-window
    repeat; it was not treated as evidence of a Cockpit write. The user
    confirmed that the resolved profile, Hermes home, workspace, conversations,
    system context, files, and jobs were the expected local data and that no
    recognizable credential, private recipient, or raw configuration content
    was exposed. The user also accepted the narrow SQLite coordination
    exception: a read-only, `query_only` connection may create an empty `-wal`
    or create/update a disposable `-shm`, while main databases, existing
    non-empty WAL files, business records, and all other Hermes files remain
    strictly unchanged by Cockpit.
  - Final R1–R9 audit: R1 passed through loopback-only read paths, the visible
    read-only boundary, unchanged quiet-window business sources, and the sole
    accepted SQLite coordination exception; R2–R6 passed through the five real
    surface flows; R7 passed through resolved-profile provenance and allowlisted
    DTOs; R8 passed through bounded reads, pagination, search, and scoped source
    states; R9 passed through 214 unit/integration tests, the deterministic
    Chromium suite, production build, and real-source acceptance.
  - Ablation removed the zero-reference mock adapter. The private manifest,
    narrow DTOs, real read-only adapters, and synthetic browser harness remain
    because they respectively preserve schema isolation, privacy, source safety,
    and reproducible CI evidence.
  - Run an ablation review across material v0.1 components: remove, replace, or
    simplify each candidate and retain it only when correctness, security,
    performance, operability, or user-experience evidence justifies it.
  - Start Cockpit on loopback using the normal project command and the agreed
    local-server fallback rule.
  - Inspect all five surfaces against the real resolved Hermes profile without
    copying personal content into logs, fixtures, snapshots, or the final
    report.
  - Verify source selection/provenance, bounded reads, partial failures, and the
    absence of mutation controls.
  - Compare source metadata before and after where meaningful, distinguish
    legitimate concurrent Hermes writes, and confirm Cockpit opened databases
    and files through read-only paths.
  - Update README with the final startup command, local URL, expected source
    roots, proxy-bypass note, verification commands, and known limitations.
  - Record the v0.1 single-user local trust assumptions in the handoff. Before
    any future remote, multi-user, browser-configurable-source,
    plugin-controlled-source, or elevated-privilege mode is accepted, require a
    new threat-model review and containment policy for Hermes internal paths.
  - Produce a final acceptance summary mapped to R1–R9 and leave all task
    checkboxes accurate.
  - _Requirements: R1, R2, R3, R4, R5, R6, R7, R8, R9_

## Deferred follow-ups outside v0.1

- [ ] Add stable, validated Overview row deep links only if real usage shows
      that section-level links are insufficient. Limit them to summaries with one
      clear destination item, and require an allowlisted stable identifier plus a
      target-page selection protocol; do not pre-emptively expand Jobs or Workspace
      DTOs. Until then, keep rows static rather than linking them to a misleading
      default selection.
- [ ] Introduce a networked/multi-user trust boundary only when Cockpit adds
      remote access, multiple operating-system users, browser-configurable or
      plugin-controlled sources, elevated privileges, telemetry, or remote error
      reporting. At that gate, add authentication and authorization, classify or
      redact allowlisted paths and authority-bearing URI references, and retest
      Host, Origin, CORS, CSP, logging, and screenshot/export behavior.
- [ ] Replace the narrow SQLite coordination-sidecar exception with a strict
      bit-for-bit read gate if local permissions, backup tooling, or file watchers
      make empty `-wal` or disposable `-shm` changes harmful, or before remote or
      multi-user operation. Do not claim that stricter boundary until its read
      mechanism and source-diff verification are accepted.
- [ ] Normalize execution timestamps to instants before SQL ranking if Hermes
      begins storing more than one timestamp offset or format. The local acceptance
      audit found only valid, consistently offset timestamps, so mixed-offset
      ranking adds no v0.1 value.
- [ ] Replace heuristic credential-name detection for allowlisted Job URL query
      and fragment values only if those values appear in the trusted Hermes source,
      or when the networked/multi-user trust boundary above is activated. The local
      acceptance audit found no current query or fragment values requiring this
      complexity. At that gate, preserve the useful origin/path and omit all query
      and parameter-bearing fragment content instead of growing an endless list of
      provider-specific signature names.

## Milestones

1. **Mock UI milestone:** Tasks 1–3 provide a complete navigable product shell
   without touching real Hermes data.
2. **Safe local-data milestone:** Tasks 4–10 connect all approved sources behind
   tested read-only boundaries.
3. **Release-candidate milestone:** Tasks 11–13 complete security, accessibility,
   responsive behavior, and automated verification.
4. **v0.1 acceptance milestone:** Task 14 validates the application against the
   real local Hermes instance and completes the handoff.

## Confirmation gate

Implementation began only after the task plan was confirmed. Future work should
continue one meaningful task at a time, preserve requirement traceability, and
update this file as status changes.
