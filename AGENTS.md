<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## First-Principles Simplicity Gate (Hard Constraint)

- Before every implementation, design, refactor, fix, or product decision,
  reduce the request to the user outcome, the observed problem, and the minimum
  constraints that must hold. Do this before choosing tools or architecture.
- Verify that the problem exists now and that solving it creates measurable
  value for Cockpit's current product stage. Do not build for hypothetical
  scale, future deployment modes, or edge cases unless present evidence or an
  accepted requirement makes them relevant.
- Choose the smallest sufficient change. Prefer deleting, reusing, or
  simplifying over adding abstractions, layers, configuration, dependencies,
  generalized infrastructure, or defensive machinery.
- Use a removal thought experiment before retaining complexity: if a component
  is removed, what current user-visible correctness, safety, or usability
  property actually fails? If no concrete property fails, remove it or record
  it as a deferred follow-up with an explicit activation condition.
- Treat unnecessary complexity as a defect. Never make a simple task complex,
  and never use speculative completeness as a reason to expand scope.

## Engineering Research and Ablation Mindset

- Before and during material technical or architectural work, inspect primary
  documentation and established, robust projects that solve comparable
  problems. Record which patterns are adopted or rejected and why; do not copy
  a pattern without testing whether its assumptions fit Cockpit.
- During design and review, use ablation experiments to challenge each
  component: remove, replace, or simplify it, then compare correctness,
  security, performance, operability, and user experience. Keep complexity only
  when evidence shows that it provides necessary value.
- Apply this process especially before inventing custom infrastructure or
  retaining a safety/performance mechanism whose benefit has not been measured.

## Code Quality Gate

- ESLint owns correctness rules; Prettier owns deterministic formatting. Reuse
  the checked-in configurations instead of introducing a competing formatter,
  linter, or duplicate CI workflow.
- Format every source, test, configuration, and documentation change with
  `pnpm format`. After each edit cycle, run the focused checks that exercise the
  changed behavior. Before handing work back or committing, run `pnpm verify`;
  when rendering, routing, browser requests, or interactions change, also run
  `pnpm test:browser`.
- The Husky pre-commit hook runs lint-staged checks for staged files. It is a
  fast local guard, not a substitute for the complete verification commands or
  the remote GitHub Verify workflow.
- Fix the root cause of a quality failure. Do not make a check pass by casually
  adding `eslint-disable`, `@ts-ignore`, `prettier-ignore`, expanding an ignore
  file, lowering warning/error thresholds, skipping tests, or using
  `--no-verify`. A real false positive requires a documented, narrowly scoped
  exception and explicit review.
- Never auto-format the eight upstream artifacts listed in `.prettierignore`
  under `tests/fixtures/codex-0.145.0/`; they preserve exact bytes with recorded
  SHA-256 provenance. Cockpit-owned fixture metadata remains subject to normal
  formatting checks.
- Report the exact commands run, their results, and any checks that could not be
  run. Do not describe an unexecuted or failing check as passing.

## Code Review Rules

### Read-only boundary

- Flag any code path that can write to Hermes files, databases, conversations,
  jobs, configuration, memory, or workspace content. Cockpit may only inspect
  approved sources through server-only, read-only adapters.
- The sole v0.1 exception is SQLite-owned WAL coordination while a source is
  opened with `SQLITE_OPEN_READONLY` and `query_only`: SQLite may create or
  restore an empty `-wal` file and may create or update the disposable `-shm`
  wal-index. This exception does not authorize application writes, changes to a
  main database, changes to an existing non-empty WAL, or changes to any
  business record or other Hermes file.
- The v0.2 Codex preview may apply that same narrow SQLite-owned
  coordination exception only to the fixed configured Codex
  `state_5.sqlite`, while Cockpit's snapshot helper opens it with
  `SQLITE_OPEN_READONLY`, `fileMustExist`, and `query_only`. The real main
  database, an existing non-empty WAL, rollouts, configuration, authentication,
  guidance, plugins, skills, and workspace content remain strictly read-only.
  Codex App Server may receive and modify only Cockpit-owned disposable snapshot
  files; this is not permission for application writes to the real Codex home.
- Revoke that exception and require a new bit-for-bit read design if local
  permissions, backup tooling, or file watchers make coordination sidecars
  harmful, or before any remote or multi-user mode is accepted.
- A credential-free temporary `HOME`, fixed environment allowlist, and scrubbed
  snapshot reduce accidental discovery but are not an OS capability sandbox.
  The v0.2 preview therefore trusts only the exact pinned Codex executable under
  the existing loopback, single-user, non-elevated model. An untrusted binary,
  remote service, elevated process, or multi-user deployment requires a new
  threat model and containment design.

### Privacy boundary

- Flag credentials, tokens, raw configuration objects, private persistence
  names, or non-allowlisted source fields that can reach Git history, logs, API
  responses, or browser DTOs. Safe responses must be newly constructed from
  explicit allowlists.
- Under the v0.1 local trust model, an allowlisted machine-specific path from a
  fixed, server-defined Hermes source—or an endpoint-like reference contained
  in such an allowlisted field—may be shown in the loopback UI or its private
  no-store API when it provides inspection value. Do still flag paths or
  endpoints entering Git history or logs, and never treat this exception as
  permission to expose credentials, persistence mappings, or browser-supplied
  paths.

### Filesystem and browser boundary

- Flag browser-controlled absolute-path inputs, traversal, workspace symlink
  escape, active HTML, unbounded content, automatic remote image loading, or
  server-only modules entering client bundles. Browser-requested workspace
  access must stay inside the canonical approved root after exclusions are
  applied.

### v0.1 local trust model

- Cockpit v0.1 is loopback-only, single-user, and runs without elevated
  privileges. Server-defined Hermes internal sources and the local user's
  Hermes configuration are trusted inputs; a symlink used only by those fixed
  internal paths is not, by itself, a review finding.
- Do flag any change that makes a Hermes home, database, or internal source path
  browser-configurable, remotely supplied, multi-user, plugin-controlled, or
  accessible with privileges the local user does not already have. Such a
  change must first introduce a new threat model and containment policy.
