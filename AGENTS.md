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
- Revoke that exception and require a new bit-for-bit read design if local
  permissions, backup tooling, or file watchers make coordination sidecars
  harmful, or before any remote or multi-user mode is accepted.

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
