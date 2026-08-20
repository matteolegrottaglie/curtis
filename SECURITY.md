# Security Policy

## Threat model

This is a **single-user, local-first** tool. It runs on your machine, holds a live LinkedIn
session, and exposes an HTTP endpoint on loopback that can act on your account. The assets worth
protecting, in order:

1. **The browser profile** (`<data-dir>/browser-profile/`) — your authenticated LinkedIn session.
   Anyone who copies it is logged in as you, without a password and without 2FA.
2. **The bearer token** (`<data-dir>/token`, mode `0600`) — grants full access to the MCP
   endpoint, which means sending invites and messages as you.
3. **The contact database** (`<data-dir>/sequencer.db`) — third parties' personal data you are
   responsible for under the GDPR.

An attacker who already has code execution as your user has access to all three. That is out of
scope: the boundaries this project defends are the **network** boundary (loopback + token) and
the **untrusted-content** boundary (what LinkedIn pages and imported CSVs can make the tool do).

## Design decisions

- **Loopback only.** The listening host is hard-coded to `127.0.0.1` and is not configurable.
  Only the port can change.
- **Bearer token by default.** Generated with `crypto.randomBytes(24)` on first run, stored with
  mode `0600`, compared with `timingSafeEqual`. Only `/`, `/healthz` and `/favicon.ico` are
  reachable without it, and none of them expose account data.
- **`LKSQ_NO_AUTH=1` disables authentication.** It exists for debugging. Do not use it: any
  process on the machine — and any web page in your browser, absent rebinding protection — could
  then send invites as you.
- **No telemetry.** The tool makes no network calls other than to LinkedIn itself. No data ever
  leaves your machine.
- **No password handling.** You log in by hand in a real browser window. The tool never sees,
  types, or stores credentials — only the resulting session.

## Reporting a vulnerability

Please report security issues **privately**, not as a public issue.

Use GitHub's private vulnerability reporting: go to the
[Security tab](https://github.com/matteolegrottaglie/Linkedin-Sequencer-MCP/security/advisories/new)
and open a draft advisory.

Include:

- what an attacker can achieve, and from what starting position;
- the file and line, or a reproduction;
- the version (`lksq version`) and your OS.

This is a hobby project maintained in spare time — expect a best-effort response within a couple
of weeks, not an SLA. Fixes land on `main`; there are no backported release branches.

### Out of scope

- Anything requiring pre-existing local code execution as the same user.
- LinkedIn detecting the automation, or an account restriction. That is the documented,
  unavoidable risk of the tool, not a vulnerability.
- Vulnerabilities in Chrome, Playwright, or other upstream dependencies — report those upstream.
  Do open an issue if this project pins a version with a known advisory.

## Hardening checklist for users

- Keep the data directory on an encrypted volume (FileVault, LUKS). The browser profile is a
  password equivalent.
- Never commit or copy `<data-dir>/` anywhere. It is git-ignored for a reason.
- Do not share the output of `lksq mcp-config`: it prints your token.
- Screenshots saved on failure may contain private messages and third parties' names. Review
  before attaching one to a bug report.
- Revoke access by deleting `<data-dir>/token` (rotates on next start) and logging out of the
  session with `linkedin_logout`.
