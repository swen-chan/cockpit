# Codex paginated history compatibility

Cockpit's pinned Codex CLI is 0.145.0. A real-source acceptance check found that
its `thread/read` full-history operation rejected paginated tasks. The previous
synthetic acceptance used legacy history only and did not cover this case.

## Smallest supported read path

- Keep the existing bounded, read-only source snapshot and one selected rollout
  copy. Never convert a source database or change its history-mode flag.
- For legacy rollouts, retain the existing full-history App Server read.
- For paginated rollouts, request **metadata only** from App Server. Decode
  explicit turn lifecycle and `item_completed` display events from the selected
  owned copy, then reuse the existing safe transcript and Process projection.
- Do not replay `response_item` mirrors: these duplicate display events and may
  contain raw arguments, outputs, or encrypted reasoning. Only recorded reasoning
  summaries are eligible for the existing projection policy.
- Bind the session and event thread identities to the requested task. Group by
  explicit turn IDs, deduplicate identical completed items, and reject conflicting
  identities, malformed records, unsupported rollback events, and false empty
  histories. Unfinished turns retain the existing in-progress display policy.
- Do not follow inherited-history references or any path in recorded content.
  The UI explicitly labels this as local recorded history, not a complete replay
  of fork ancestors. Existing turn, message, Process, and response budgets apply;
  source decoding is also capped at 32 MiB and 100,000 records.

## Adopted and rejected alternatives

The [official App Server documentation](https://learn.chatgpt.com/docs/app-server)
distinguishes read-only inspection from resuming a task and documents limitations
for paginated history. Cockpit keeps that no-resume boundary. A metadata-only
read succeeded in the local diagnostic, but the experimental turn-list operation
returned no turns from the existing isolated snapshot despite nonempty records.
It therefore cannot be treated as proof that a task has no history.

Changing a copied history-mode flag would disguise a different format as legacy;
reading the live source through App Server would bypass the accepted isolation
boundary. Neither is used. A second database, new configuration, raw-output viewer,
automatic source migration, and unrestricted history traversal are unnecessary.

## Regression evidence

`tests/fixtures/codex-paginated.json` is hand-authored synthetic data matching the
observed display-event structure. It contains no copied personal messages or
machine paths. It is Cockpit-owned, not an upstream generated schema.

Tests cover the decoder, existing safe projection, metadata-only protocol,
operation cleanup, and a browser task that rejects the old full-history request.
Browser fixtures fingerprint their source files before and after the run. Real
acceptance must separately check safe message/Process counts and the rendered UI;
synthetic test success alone is not evidence of real-source compatibility.
