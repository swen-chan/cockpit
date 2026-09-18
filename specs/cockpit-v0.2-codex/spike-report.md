# Codex Synthetic Read Spike — 2026-09-15

## Verdict and boundary

**GO: all ten Task 1 synthetic checks pass.** Task 1 now has reusable server-only
reader prerequisites and synthetic tests; application routes and browser UI are
unchanged. No Git commits, remote settings, or real Agent sources were changed.
All experiments used newly owned temporary directories and synthetic history.
No Agent turn, login, installation, downgrade, or elevated Codex process was run.

The user approved the actual empty placeholder and narrower OS outbound-deny
acceptance on 2026-09-15. Both are implemented and tested below. This does not
claim zero attempted connections or continuous production OS enforcement.
Task 2 subsequently completed its structural panel, contract, and token
foundation. This verdict does not authorize real-source acceptance, application
integration beyond the confirmed task plan, or repository writes.

## Current reusable implementation evidence

- `owned-temp.mjs`: fixed canonical Unix `/tmp` root, UID-owned `0700` operation
  directories, exact private markers, bounded stale scan and conservative live
  PID/group preservation. 36 focused tests passed.
- `stable-copy.mjs`: fixed initial size, one restart, descriptor/name identity,
  append/replacement/shrink/short-read negatives and private-output cleanup.
  23 focused tests passed; the existing SQLite boundary's 16 tests also passed.
- `snapshot-worker.mjs`: read-only/query-only online backup, shared DB+WAL and
  SHM caps, one selected rollout, all non-null copied paths scrubbed, nulls
  preserved, no source edits. 37 focused tests passed.
- `protocol.mjs` / `owned-process.mjs`: fixed sterile argv/environment, numeric
  two-response state machine, fatal UTF-8, byte/deadline/RSS controls, abort and
  group reclamation. 51 protocol tests and 8 worker-lifecycle tests passed.
- Composed private reader cleanup: 14 tests passed, including safe worker error
  propagation and owned-home removal after representative success/failures.
- Six unchanged exact-0.145.0 generated wire schemas have provenance, SHA-256,
  upstream LICENSE/NOTICE and self-contained-reference checks. 10 contract tests
  passed, using existing Zod; CI neither installs nor downloads Codex.

The explicit manual runner `tests/spike/codex-read.mjs` passed these six checks:
exact version under OS denial; parent/descendant outbound and source-read denial
controls; active-WAL backup plus five-item recency list/cursor; selected legacy
detail with ID/source binding; original fixture identity/bytes/mtime preservation
with only the exact SHM exception; actual over-limit parent+descendant RSS group
reclamation. The RSS stage observed one sample, two group members and a peak of
549,392 KiB in the final basic-flow recheck. This is a sampled operational stop,
not a kernel memory ceiling.
Every operation directory from that runner was removed.

The ordinary tool sandbox could not apply a nested macOS sandbox profile
(`sandbox_apply` permission failure). The approved same-UID, non-root run outside
the tool sandbox applied the deny policy successfully. No machine policy, SIP,
privilege level, or service registration was changed. The result projects only
fixed verdicts, stage names, codes and numeric counts; internal raw replies never
mention the original fixture directory and are not browser DTOs.

Full local `pnpm verify` now passes: typecheck, lint, 33 files / 412 tests and
production build. This is local synthetic evidence, not browser, GitHub,
application-integration or real-history acceptance.

## Final ten-check verdict

| Design §15 check                         | Verdict | Evidence                                                                                                       |
| ---------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------- |
| 1. Isolated version/source boundary      | PASS    | Sterile exact-version probe plus parent and descendant synthetic source-read denial controls                   |
| 2. Bounded readable online backup        | PASS    | Active-WAL snapshot produced the five-item state-only list within the helper deadline                          |
| 3. Scrubbed list and one bound detail    | PASS    | All non-null copied paths were rewritten; one stable copied rollout returned the requested ID/source           |
| 4. Stable-copy mutation handling         | PASS    | Append, replacement, shrink and short-read cases passed the one-restart/bounded-failure suite                  |
| 5. Source immutability                   | PASS    | Main DB, non-empty WAL and rollout fingerprints remained unchanged within the exact SHM exception              |
| 6. Temporary App Server boundary         | PASS    | App Server used only the owned home and safe results contained no raw source path                              |
| 7. Success/failure cleanup               | PASS    | Focused failure suites and both manual runners removed only validated owned resources                          |
| 8. Parent-loss EOF and live preservation | PASS    | Tightened PID-and-PGID runner passed App Server, waiting helper and active-backup cases without forced cleanup |
| 9. Process and resource caps             | PASS    | Protocol/unit cases passed; actual over-limit parent+descendant group was reclaimed by the RSS watchdog        |
| 10. Outbound-deny operation              | PASS    | Pinned probe/list/read passed under the macOS deny policy; parent and descendant controls failed with `EPERM`  |

## Parent-loss result and historical failed checker

The independent `tests/spike/codex-parent-loss.mjs` holds child stdout/stderr open
in the surviving launcher, kills only its own host, and lets child stdin receive
EOF. Empty initialized App Server and waiting-helper cases passed: about 13 ms
and 15 ms to exit, no forced child cleanup, real live-directory preservation,
then successful stale removal after process exit.

An active-backup case uses only an owned synthetic SQLite database of
126,828,544 bytes. Under the final minimal helper environment, an earlier run failed
after observing a 16,384-byte destination and killing the host. The child exited
without forced cleanup, but the active reply/acceptance stage did not pass;
the source fingerprint check was not reached and only 3 of 4 operation
directories were immediately removed. The old checker did not capture a stage
or reply code, so that historical result remains unclassified rather than being
rewritten as a passing run.

Static review found two checker defects. First, its group-only disappearance
test could release the run while the leader PID was still visible, whereas the
reaper correctly requires both PID and process group to be absent. That timing is
consistent with the historical 3-of-4 cleanup result. Second, the checker
required the diagnostic reply after host death to be exactly `source_busy`, even
though design §15 check 8 requires bounded exit, source preservation and safe
cleanup rather than one incidental EOF code. With the host gone, no application
request can consume that reply. The result checker now accepts only the fixed
safe shape, still rejects wire errors, and continues through fingerprint and
reaper verification.

The tightened PID-and-PGID checker then passed twice. The final result-based run
observed a 315,392-byte in-progress destination, received the fixed
`source_busy` safe code, and saw the child exit 13 ms after host loss. It reported
zero wire failures and zero forced cleanup; the source fingerprint matched, all
four operation directories were removed, and the synthetic source and root were
removed. The earlier old-checker reply cannot be reconstructed, so this is a
current acceptance result, not a claim that the old run never failed. No
production worker change was needed.

The failed run's remaining exact owned fixture was separately recovered after
UID, inode, canonical path, modes, marker, synthetic schema/content and all
recorded PID/PGID absence checks. One operation, one synthetic DB and its root
were removed; zero test roots remain. No unknown/live directory was deleted.

## Earlier disposable diagnostics (historical evidence)

| Diagnostic                            | Observed result                                                                                                                                                                                             | Evidence limit                                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Sterile standalone version probe      | `codex-cli 0.145.0`, exit 0, within the 2-second/4-KiB probe bounds                                                                                                                                         | Does not prove absence of transient file reads or network attempts                                    |
| Desktop-bundled version probe         | `0.153.4`, rejected as a target for this spike                                                                                                                                                              | No cross-version compatibility claim                                                                  |
| Isolated initialize and stdin EOF     | Temporary canonical home and Unix/macOS identity matched; normal exit 0 about 3 ms after EOF; owned group gone                                                                                              | Normal pipe close only, not simulated parent SIGKILL                                                  |
| Original nonexistent sentinel         | Six copied rows, but state-only list returned zero tasks and no cursor                                                                                                                                      | Reproduced mismatch, not a passing integration                                                        |
| Candidate existing empty placeholder  | State-only list returned five synthetic tasks in expected recency order and a next cursor                                                                                                                   | Positive synthetic legacy sample only                                                                 |
| Read-only active-WAL backup and scrub | Online backup contained the six fixture rows, including live-WAL writes; all query-visible paths contained in the disposable copy                                                                           | Cooperative fixture; blocking and deadline injection not yet tested                                   |
| Candidate selected-rollout detail     | Exactly one stable copied legacy rollout yielded user/final content; returned task ID and `cli` source matched                                                                                              | No Process, pagination, mutation/retry, or full DTO proof                                             |
| Source fingerprints                   | Synthetic source files, main DB, existing non-empty WAL and rollouts retained identity, bytes, size and high-resolution mtime; only the exact state-DB SHM was separately classified                        | No real-source claim; the full sidecar-negative suite is still required                               |
| Success cleanup                       | Version/initialize and smoke data directories were removed; all recorded operation groups were gone                                                                                                         | No failure/crash/reaper acceptance claim                                                              |
| Candidate OS outbound-deny experiment | The same synthetic list/detail flow passed under a macOS `sandbox-exec` policy denying outbound networking; separate parent and descendant reserved-address, no-content controls were rejected with `EPERM` | Originally a proposal; the user later approved this narrower acceptance, not zero-attempt observation |

The successful candidate smoke performed one list and one detail operation.
Snapshot helper diagnostics completed in about 49 ms and 47 ms respectively.
Those times are not a benchmark or a deadline-injection proof. Each child was
too short-lived for the 250-ms RSS sampler: zero enumeration samples and zero
measured peak RSS mean **unmeasured**, not a zero-memory or watchdog PASS.

Those earlier diagnostics reused existing dependencies. Subsequently the public
checkout's dependencies were restored using the unchanged frozen lockfile and
offline cache, with zero downloads. Current verification is described above;
no browser or GitHub check was run.

## Root cause and approved minimum correction

`useStateDbOnly:true` prevents rollout discovery/repair scanning, but the audited
reader still checks each recorded rollout path. Missing paths are omitted, and
their rows may be deleted from the **disposable copied** database. The observed
empty list matches the pinned [official list implementation](https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/rollout/src/state_db.rs#L403-L428).

Correction approved by the user and implemented:

1. Create one actual empty `0600` regular placeholder JSONL inside the canonical
   owned operation directory before scrubbing the copied database.
2. Map every non-null copied rollout path to that validated placeholder; preserve
   nulls and retain affected-row-count validation. Never give App Server an
   original rollout path or copy all task rollouts.
3. For a selected detail, restore only its stable copied rollout path. Keep
   state-only list, read-only online backup, child bounds, source protection and
   cleanup unchanged.

This adds only one inert temporary file, not a database layer, reader fallback,
directory scan, or permanent storage. Removing it recreates the observed empty
list. The reusable implementation now passes list and stable legacy detail.
That alone does not confer the complete Task 1 GO verdict.

This matches the pinned upstream's own empty-placeholder
[state-only list test](https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/thread-store/src/local/list_threads.rs#L240-L297);
it is not a new custom discovery mechanism.

## Version-specific history limit requiring review

The pinned official tests reject `thread/read(includeTurns:true)` for paginated
history. The successful fixture explicitly used **legacy** history and cannot
be generalized to every task produced by 0.145.0. The product must either show
an honest unavailable-detail state for unsupported history, or receive a
separately researched design amendment. No alternate method/version was enabled
in this spike. See the [pinned rejection test](https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/app-server/tests/suite/v2/thread_read.rs#L270-L284).

The fixture used the pinned [thread metadata fields](https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/state/src/runtime/threads.rs#L1112-L1144)
and [legacy history test records](https://github.com/openai/codex/blob/rust-v0.145.0/codex-rs/app-server/tests/suite/v2/thread_read.rs#L1919-L1950).
The exact binary initialized the empty fixture database; migration metadata was
not hand-built. Official [App Server documentation](https://learn.chatgpt.com/docs/app-server)
establishes the initialize/list/read protocol, not this spike's safety verdict.

## Observation limit and remaining work

The macOS DTrace capability check failed in the normal sandbox. The separately
approved unsandboxed read-only capability check reported additional privileges
were required. A non-interactive capability check could not proceed without a
password. No system protection was disabled, no password was requested or
collected, no unrelated traffic was captured, and Codex was never elevated.

Therefore complete process-attributed transient connection/file-access
observation is **UNVERIFIED**, not proof that the reader made an external request
and not proof that it did not. An ordinary socket snapshot or browser request
check is not an equivalent substitute.

A no-administrator candidate was tested separately: run the synthetic flow under
an OS policy that denies outbound networking, and verify the deny with a
controlled no-content connection to a reserved documentation address. The flow
passed and parent/descendant controls failed with `EPERM`. This is useful enforcement evidence,
but **does not establish zero attempted requests**, observe every transient read,
or add an OS sandbox to production. The user explicitly approved the narrower
network amendment. Current source isolation additionally passes synthetic
source-read denial and its control, not full syscall observation. Neither system
protection nor system configuration was changed.

Task 1's synthetic acceptance is complete. Paginated history remains unsupported
by the pinned read method; no fallback or version switch was introduced. Task 2's
contract-only foundation is also complete. Browser, application integration and
real-source acceptance remain later, separate gates.

## Next gate

Begin Task 3's production snapshot and one-operation reader boundary. Keep all UI
work behind its declared dependencies. Real-source access, commits/pushes/PRs,
and release authorization remain separate.

References: [requirements](requirements.md), [design](design.md), [tasks](tasks.md).
