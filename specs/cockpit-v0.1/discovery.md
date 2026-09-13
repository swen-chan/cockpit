# Cockpit v0.1 Sanitized Local Discovery

## Purpose

This document records only the architectural conclusions needed to develop
Cockpit. Machine-specific paths, account names, installed versions, record
counts, database filenames, table names, field names, and configuration values
have deliberately been removed before repository publication.

The placeholders used throughout the repository are:

- `<local-path>` — a path selected on the developer's own machine.
- `<HERMES_HOME>` — the resolved private Hermes state directory.
- `<CONVERSATION_STORE>` — the private conversation persistence source.
- `<SESSION_RECORDS>`, `<MESSAGE_RECORDS>`, `<PROMPT_RECORDS>` — private logical
  record collections behind the conversation adapter.
- `<SAFE_CONFIG_SOURCE>` — the private configuration source read through an
  explicit allowlist.
- `<JOB_DEFINITION_SOURCE>` and `<JOB_EXECUTION_STORE>` — private scheduled-job
  sources.

## Repository and runtime

The project began as an empty local repository under
`<local-path>/cockpit`. Node.js and pnpm are available. Exact machine and
tool versions are intentionally not recorded here; supported versions live in
the package manifest and README instead.

## Source inventory

### Workspace context

An approved workspace exists under `<local-path>/Hermes`. It contains normal
text documents and may also contain binary, oversized, hidden, credential-like,
or private files.

The explorer therefore requires canonical path containment, dot-path and
credential exclusions, conservative content detection, bounded previews, and
escaped rendering. HTML is displayed only as source text.

### Conversations and prompt snapshots

Hermes exposes a private local conversation store containing session records,
message records, and prompt snapshots. Cockpit accesses it only through a named
read-only adapter; storage names and schema details must never cross the browser
boundary or appear in diagnostics.

The adapter must use bounded queries, stable cursor pagination, a finite busy
timeout, and explicit DTO allowlists. Hidden reasoning, raw API data, origins,
and raw tool payloads remain server-side. Prompt previews require eligible
session/time provenance so a historical snapshot is never presented as a
product-managed current version.

### Memory and operating context

Private memory, user-profile, operating-principle, and repository-instruction
documents exist behind named adapters. Lock files and other implementation
artifacts are not UI sources and are never acquired or modified.

### Skills, tools, and providers

Skills are discoverable from approved non-dot directories. Cockpit reads safe
frontmatter and bounded bodies on demand. Effective toolsets and model/provider
identifiers come from an allowlisted configuration summary; implementation-file
scanning is not evidence that a capability is enabled.

Configuration may contain credentials, private endpoints, headers, environment
references, and authentication state. The parsed source object is never sent to
the browser. A new safe response is constructed from approved fields.

### Jobs

Job definitions and execution metadata exist in separate private local sources.
Cockpit may expose name, schedule, state, safe timestamps, failure streak,
profile, toolset names, delivery platform/type, and bounded execution status.

Prompts, scripts, raw errors, endpoints, recipients, process identifiers,
claims, and outputs remain excluded. Source filenames and record structures are
private adapter implementation details.

## Security boundary

Hermes state can contain credentials, authentication state, request dumps,
logs, caches, backups, provider configuration, and personal content. Cockpit
uses two distinct policies:

1. **Hermes state:** accessible only through named, server-only adapters.
2. **Approved workspace:** browsable only through canonical containment,
   exclusions, content classification, and strict preview limits.

No generic endpoint accepts arbitrary absolute paths. Browser DTOs are built
from allowlists, diagnostics use safe source IDs, and tests operate on synthetic
fixtures or isolated read-only copies.

## Readiness conclusion

The required local source categories exist and are structurally sufficient for
Overview, System, Conversations, Files, and Jobs. No application database or
separate backend is justified. This sanitized summary intentionally contains no
personal content or machine-specific source schema.
