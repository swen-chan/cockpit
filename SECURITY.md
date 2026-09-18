# Security Policy

## Supported versions

The latest `v0.1.x` release receives best-effort security fixes. Earlier
development snapshots are not supported releases.

## Reporting a vulnerability

Please report suspected vulnerabilities through GitHub Private Vulnerability
Reporting for this repository. Do not open a public issue with exploit details.

Include the affected version or commit, operating system, impact, and a minimal
reproduction using synthetic data. Never upload real tokens, conversations,
databases, configuration, local paths, screenshots, or logs from a personal
Hermes instance.

## v0.1 trust model

Cockpit v0.1 is designed for one trusted local operator. It binds to loopback
and inspects fixed server-defined sources through bounded, read-only adapters.
It must run without elevated privileges; elevated execution is unsupported.
LAN exposure, port forwarding, tunnels, reverse proxies, cloud hosting, and
mutually untrusted users are outside the supported boundary.

`COCKPIT_SOURCE_PRESET`, `COCKPIT_SOURCE_MANIFEST`, `COCKPIT_HERMES_HOME`,
`HERMES_HOME`, and `COCKPIT_WORKSPACE_ROOT` are trusted, operator-controlled
startup configuration. They cannot be selected through the browser or an HTTP
request.

Examples of in-scope security issues include:

- credentials or non-allowlisted private data reaching logs or browser DTOs;
- a browser-controlled path escaping the approved workspace;
- Cockpit changing Hermes business data or source content;
- bypassing the loopback Host or Origin boundary;
- source content executing active HTML or triggering unexpected remote loads.

Feature requests, unsupported remote deployments, and behavior already stated
in the documented local trust model can be filed as regular issues without
including private data.

## Unreleased v0.2 Codex development boundary

Codex support is development work for an unreleased v0.2 and is not covered by
the supported-version statement above. Its reader is limited to the explicitly
configured local Codex home, the pinned Codex CLI version, and the fixed
`state_5.sqlite` source. Cockpit prepares a disposable snapshot by opening that
database with `SQLITE_OPEN_READONLY`, `fileMustExist`, and `query_only`.

That read may use only SQLite's narrow coordination behavior: SQLite may create
or restore an empty `-wal` companion and may create or update the disposable
`-shm` wal-index. It may not change the real main database, an existing non-empty
WAL, a business record, a rollout, configuration, authentication, guidance,
plugins, skills, or workspace content. Codex App Server receives only
Cockpit-owned temporary snapshot files; its ability to write those disposable
files does not authorize application writes to the real Codex home. If the
coordination sidecars are harmful to local permissions, backup tooling, or file
watchers, the Codex panel must fail closed until a bit-for-bit reader is
available.

The temporary credential-free `HOME`, fixed environment allowlist, scrubbed
snapshot paths, and directly owned process groups are defense-in-depth controls,
not an OS capability sandbox. The unreleased reader therefore trusts the exact
pinned Codex executable and retains the v0.1 loopback-only, single-user,
non-elevated operating model. Untrusted executables, remote App Servers,
multi-user service, elevated execution, or cloud deployment require a new
threat model and containment design before they can be supported.

An unclean host termination may leave a mode-`0600` snapshot inside Cockpit's
mode-`0700`, same-user temporary directory. On the next Node server startup,
Cockpit examines only a bounded set of its own validated stale directories and
removes one only after every recorded process and process group is confirmed
gone. Ambiguous identity or liveness leaves the directory untouched; cleanup
never signals a process or follows a path from the owner marker.

Cockpit does not currently operate a bug bounty or promise a fixed response
timeline. Reports will be handled on a best-effort coordinated-disclosure basis.
