# Kvasir channel + bridge (`mimir`)

A Claude Code **channel** (stdio MCP server with the experimental
`claude/channel` capability) plus a small **localhost HTTP bridge**. Built on the
Claude Code channel pattern (a stdio server that pushes events into your session).

## What it does

- Exposes tools to your Claude session:
  - `start_walkthrough({ pr })` — fetches the PR's changed-files manifest via
    `gh` (paths, GitHub diff anchors, per-file patches, head SHA).
  - `publish_walkthrough({ spec })` — stores a walkthrough spec to serve.
  - `answer_question({ id, answer })` — answers a pending browser question.
- Serves the Chrome extension over HTTP (`http://localhost:8799`):
  - `GET /health`
  - `GET /walkthrough?pr=<url>` → the stored spec, or `{ status: "absent" }`
  - `POST /ask` `{pr,stepId,file,selection,question}` → an answer from your session
  - `POST /push` `{review}` → store a pushed cross-repo review, returns its `?kvasir=` link
  - `GET /review?id=<id>` → a stored review · `GET /history` → `{ entries: [...] }` summaries for the history list
  - `DELETE /entry?id=<id>` → soft-delete a stored walkthrough (drops it from `/history` and stops serving it)
  - `POST /suggest` `{pr,file,selection}` → 3–4 suggested questions

Browser questions are pushed into your session as
`<channel source="kvasir" event_type="code_question|suggest_questions" ...>`
events; you answer and call `answer_question` to send the reply back.

## Requirements

- [Bun](https://bun.sh) (the channel is a Bun script)
- [`gh`](https://cli.github.com/) authenticated to your GitHub account — this is
  the only "auth", and it's the login you already have. No token in config.
- Claude Code v2.1.80+ with channels enabled for your org.

## Setup

```sh
cd packages/mimir
bun install
```

## Run

Register it as an MCP server in the `.mcp.json` at the directory you launch
`claude` from, then start with the channel flag. A manually-configured server is
tagged `server:` (the `plugin:<name>@<marketplace>` form is only for
marketplace plugins). During the research preview, a channel that isn't on the
Anthropic allowlist needs the dev flag to load locally:

```sh
claude --dangerously-load-development-channels server:kvasir
```

Note: the dev flag takes the tagged entry itself (it replaces `--channels` for
local channels) — don't pass both. That flag only permits loading your own
non-allowlisted channel; it does NOT skip tool-permission prompts. Inbound
channel messages are untrusted input, which the channel handles by tagging
selected code as data, not instructions.

The `.mcp.json` entry:

```json
{
  "mcpServers": {
    "kvasir": {
      "command": "bun",
      "args": ["run", "<abs-path>/kvasir/packages/mimir/src/main.ts", "channel"]
    }
  }
}
```

Confirm the bridge is up:

```sh
curl http://localhost:8799/health      # → {"ok":true,"specs":0}
```

Dev-testing note: launch `claude` directly (as above) to exercise unbuilt source
here — NOT the installed `kvasir run`. That command self-supplies the compiled
binary via `--mcp-config`, and a CLI-supplied `kvasir` server wins over this
repo-local `.mcp.json` entry, so `kvasir run` would silently run the installed
binary instead of your source edits.

## Config (env)

| Var              | Default                   | Purpose                               |
| ---------------- | ------------------------- | ------------------------------------- |
| `KVASIR_ORIGIN`  | unset (nothing reflected) | optional extra CORS origin — see note |
| `ASK_TIMEOUT_MS` | `120000`                  | how long `/ask` waits for your answer |

The port is fixed at `8799` (the shared `KVASIR_PORT` constant in
`@kvasir/runes/port`), not configurable: the extension's manifest pins its host
permission to that exact origin, so a channel on any other port would be
unreachable by the shipped extension.

## Security

This server is a **local bridge**. While it runs, it listens on a TCP port, and
`/ask` and `/generate` drive your Claude Code session — so it's only as safe as
its access controls. The design assumes the only legitimate caller is this
project's browser extension, on the same machine. Defenses:

- **Loopback only.** It binds `127.0.0.1`, so it is not reachable from your
  network — only from your own machine.
  These checks are **not secrets** — they don't depend on an attacker not knowing
  the header name or reading this source. They rely on signals the _browser_ sets
  and enforces, which a malicious page cannot forge. That's why the design is safe
  to open-source, and why a token/handshake adds nothing against a browser attacker
  (and nothing against malware already on the machine, which can read any secret).

- **Origin check.** A cross-origin request always carries an `Origin` header the
  page cannot spoof. If `Origin` is a foreign web origin, the request is rejected
  server-side — independent of CORS. The extension's background worker sends a
  `chrome-extension://` origin (or none), which passes.
- **Guard header.** Every request must carry the `x-kvasir` header. A web
  page cannot set a custom header on a "simple" cross-origin request, and any
  request that does set it is forced through a CORS preflight this server does not
  grant. So a malicious site **cannot** make your browser drive this bridge (no
  localhost CSRF). The extension sets it from its background worker (not CORS-bound).
- **Host check.** Requests whose `Host` isn't loopback are rejected, which blocks
  DNS-rebinding (a domain that resolves to `127.0.0.1`).
- **No wildcard CORS.** No `Access-Control-Allow-Origin: *`, and nothing is granted
  by default (the extension's worker isn't CORS-bound, so it never needs a grant).
  `KVASIR_ORIGIN` adds one extra allowed origin — **never set it to a multi-tenant
  origin like `https://github.com`**: that would let any script running on that
  origin reach the token-less routes (`/history`, `/review`, `DELETE /entries`).

Residual risks to be aware of:

- **Same-machine processes.** Any program already running on your machine can call
  the bridge. This is a localhost dev tool; treat a compromised machine as out of
  scope.
- **Prompt injection from untrusted PRs.** If you open a walkthrough/chat on a PR
  authored by someone you don't trust, that diff is attacker-controlled text. The
  channel tags selected code as _data, not instructions_, and your session's tools
  remain user-gated — but prompt-injection mitigation is never perfect. Don't run
  a walkthrough against a hostile PR and then blindly approve session actions.
- Spec HTML rendered by the extension is allowlist-sanitized (inline tags only,
  all attributes stripped) as defense-in-depth.

## Test without Claude

`sample/walkthrough.sample.json` is an example spec (a fictional `acme/widget-api`
PR) showing the format. You can serve it manually (send the `x-kvasir`
header), or point the extension at it while developing.

## TODO

- Optional: a cheap-model path for `/ask` and `/suggest` so rapid-fire questions
  don't use the main session (needs an API key — skipped on locked-down accounts).
- Stream answers instead of long-poll.
