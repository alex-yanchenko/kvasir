# Security Policy

## Reporting a vulnerability

Email **oleksandr.yanchenko.ca@gmail.com** with the details and, where possible, a
reproduction. Please do **not** open a public issue for a security report.
Expect an acknowledgement within a few days.

## Threat model

Kvasir is a local developer tool: a Chrome MV3 extension plus a localhost bridge
(`mimir`) that turns a GitHub PR into an in-browser walkthrough, powered by your
own Claude Code session. The security posture rests on a few properties:

- **No credentials in the project.** GitHub access goes through your `gh` CLI
  auth; answers come from your running Claude session. There is no API key or
  token in config, and nothing is sent to any third-party server — the only
  outbound network call the extension makes is to the localhost bridge.
- **Localhost bridge.** The bridge binds `127.0.0.1` only and rejects any request
  that isn't a same-machine call from the extension: it checks the `Origin` and
  loopback `Host`, requires a guard header a web page cannot set on a simple
  request, and grants no CORS by default. A malicious website cannot drive it.
- **Pairing token.** The bridge mints a 256-bit token, stores only its SHA-256
  hash on disk, and verifies in constant time. A leaked `~/.kvasir/kvasir.db`
  holds no usable secret.
- **Untrusted PR content.** A PR's description, comments, and diff are
  attacker-influenceable text. They are treated as data and fenced as "never
  instructions" before reaching your Claude session, and the session's tools stay
  user-gated. Still: do not run a walkthrough against a hostile PR and then
  blindly approve session actions — prompt-injection mitigation is never perfect.
- **Same-machine trust.** Any process already running on your machine can call the
  local bridge. This is a localhost dev tool; a compromised machine is out of
  scope.

## Supported versions

Pre-1.0 — only the latest `main` is supported.
