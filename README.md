<p align="center">
  <img src="docs/assets/cockpit-banner.png" alt="Cockpit — local, read-only observability for Hermes Agent" width="100%">
</p>

# Cockpit

**A local, read-only observability console for one Hermes Agent.**

[![Verify](https://github.com/swen-chan/cockpit/actions/workflows/verify.yml/badge.svg?branch=main)](https://github.com/swen-chan/cockpit/actions/workflows/verify.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-c6ff3d?style=flat-square&labelColor=0e0e0e)](LICENSE)
![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-c6ff3d?style=flat-square&labelColor=0e0e0e)

Cockpit brings recent activity, active context, visible workspace files, and
scheduled jobs into one browser interface. It inspects your local agent without
sending messages, editing files, controlling jobs, or creating a second
application database.

> [!IMPORTANT]
> **v0.1 is a developer preview.** It has been validated against one local
> Hermes data layout and currently requires an explicit private source manifest.
> It is not a universal Hermes installer.

Cockpit is an independent open-source project. It is not affiliated with or
endorsed by [Nous Research](https://nousresearch.com/) or the
[Hermes Agent](https://github.com/NousResearch/hermes-agent) project.

## What you can inspect

| Surface | What it answers |
| --- | --- |
| **Overview** | What is happening across the resolved local sources? |
| **System** | Which profile, context, skills, tools, and source documents are active? |
| **Conversations** | What happened in eligible interactive sessions? |
| **Files** | Which approved workspace files are visible, and what do they contain? |
| **Jobs** | What is scheduled, what ran recently, and what state is each job in? |

Every surface is intentionally bounded and read-only. Source failures stay
local to the affected section instead of taking down the entire interface.

## Developer setup

### Requirements

- Node.js 24 or newer
- pnpm 10.28.1
- A compatible local Hermes data layout

Clone and install:

```bash
git clone https://github.com/swen-chan/cockpit.git
cd cockpit
pnpm install
cp cockpit.local.example.json cockpit.local.json
```

The copied manifest is a synthetic structure template. Edit it so its relative
paths, table names, and field names match your local Hermes layout. The real
`cockpit.local.json` is ignored by Git.

Create an ignored `.env.local`:

```dotenv
COCKPIT_WORKSPACE_ROOT=/absolute/path/to/your/hermes/workspace
COCKPIT_SOURCE_MANIFEST=/absolute/path/to/cockpit/cockpit.local.json
# Optional: explicitly select a custom or named Hermes home.
# COCKPIT_HERMES_HOME=/absolute/path/to/your/.hermes/profiles/profile-name
```

Start Cockpit:

```bash
pnpm dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). A healthy setup shows the
five read-only surfaces above. If your browser or shell uses a proxy, bypass it
for `localhost`, `127.0.0.1`, and `::1`.

> [!WARNING]
> Do not expose v0.1 through a LAN binding, port forward, tunnel, or reverse
> proxy. It is designed for one trusted operator on the same machine.

<details>
<summary><strong>Configuration and manifest notes</strong></summary>

`cockpit.local.json` maps Cockpit's allowlisted fields to local configuration,
conversation, job-definition, and execution-ledger sources. Never commit the
real manifest, `.env.local`, credentials, database files, or local source
content.

`promptTable` and `promptColumns` are an optional pair and require
`sessionColumns.promptHash`. The complete `messages` and `jobs` groups can be
omitted, but their corresponding surfaces will be unavailable. Keep and map
them for the full five-surface experience.

Hermes home resolution follows this order:

1. `COCKPIT_HERMES_HOME`
2. `HERMES_HOME`
3. the profile named by `~/.hermes/active_profile`
4. the default `~/.hermes` home

`COCKPIT_WORKSPACE_ROOT` is a separate, mandatory approved root for Files and
workspace-owned System documents.

</details>

## Privacy and security

- Cockpit binds to `127.0.0.1` and does not provide authentication or TLS.
- Hermes sources are opened through server-only, bounded, read-only adapters.
- Browser responses are constructed from strict allowlists; credential files,
  raw configuration, tool payloads, and private persistence mappings are
  excluded.
- Markdown and HTML-like content is rendered inertly. Remote images and active
  HTML are not loaded.

SQLite may create an empty `-wal` file or create/update a disposable `-shm`
wal-index while a source is opened with `SQLITE_OPEN_READONLY` and `query_only`.
This narrow coordination behavior does not permit Cockpit to change a main
database, an existing non-empty WAL, business records, or other Hermes content.

Read [SECURITY.md](SECURITY.md) before changing the trust boundary, and use its
private reporting channel for potential vulnerabilities. Do not publish tokens,
local paths, conversations, databases, or private configuration in an issue.

## Production

Build first, then start the same loopback-only application:

```bash
pnpm build
pnpm start
```

## Development and verification

```bash
pnpm verify
pnpm exec playwright install chromium  # first browser-test setup only
pnpm test:browser
```

`pnpm verify` runs type checking, lint, unit/integration tests, and the
production build. The browser suite runs Chromium flows against a temporary
synthetic Hermes environment; it refuses to reuse a real server on port 3000.

For a focused issue or pull request, keep changes inside the current local,
read-only, single-user boundary, run both verification commands, and never
attach real Hermes data or machine-specific configuration.

The implemented requirements, technical design, and acceptance history live in
[`specs/cockpit-v0.1`](specs/cockpit-v0.1/).

<details>
<summary><strong>Known limitations</strong></summary>

- v0.1 supports one trusted local operator and has no authentication or TLS.
- The synthetic manifest is a structure template, not automatic source
  discovery. It must be mapped to a compatible local Hermes data layout.
- Independent source reads may show different observation times while Hermes is
  changing; Cockpit does not create a canonical snapshot.
- Lists and previews are deliberately bounded. Unsupported, binary, and
  oversized files expose metadata only.
- Cross-conversation search, stable row-level deep links, mutation controls,
  remote access, cloud hosting, and multi-user operation are outside v0.1.
- All dates currently display in the fixed `Asia/Shanghai` time zone.

Any future remote, multi-user, browser-configurable-source, plugin-controlled,
or elevated-privilege mode requires a new threat model and containment review
before implementation.

</details>

## License

[MIT](LICENSE) © 2026 swen-chan.
