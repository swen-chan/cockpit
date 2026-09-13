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

Examples of in-scope security issues include:

- credentials or non-allowlisted private data reaching logs or browser DTOs;
- a browser-controlled path escaping the approved workspace;
- Cockpit changing Hermes business data or source content;
- bypassing the loopback Host or Origin boundary;
- source content executing active HTML or triggering unexpected remote loads.

Feature requests, unsupported remote deployments, and behavior already stated
in the documented local trust model can be filed as regular issues without
including private data.

Cockpit does not currently operate a bug bounty or promise a fixed response
timeline. Reports will be handled on a best-effort coordinated-disclosure basis.
