# PR Walkthrough

Turn a GitHub PR into an interactive, in-browser walkthrough — a guided tour that
scrolls the diff, highlights the lines that matter, and explains each one — plus
a "select code and ask" modal for on-the-spot questions. The smart content is
generated once by Claude and cached; the browser just renders it.

This started as a live demo (Claude driving a browser via the automation
extension) and was rebuilt into something stable, cheap, and credential-free.

## Layout

A pnpm-workspaces monorepo:

```
pr-walkthrough/
├── packages/
│   ├── server/      Claude Code channel + localhost HTTP bridge (Bun + TypeScript)
│   └── extension/   Chrome MV3 extension that renders the tour + ask-modal
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

The two sides are decoupled by a single contract: the **walkthrough spec** (see
`packages/server/src/spec.ts`). The server produces and serves specs; the
extension consumes them. Either side can change independently.

> Setup note: register the channel in a local `.mcp.json` pointing at
> `packages/server/src/channel.ts` (this file is gitignored — it holds a
> machine-specific absolute path).

## How it fits together

```
  You (chat)                Claude Code session                 Chrome
  ──────────                ───────────────────                 ──────
  "review PR &      ─────▶  start_walkthrough(pr)  ──gh──▶  GitHub (PR diff)
   walk me through"         author spec
                            publish_walkthrough(spec) ──▶  server cache
                                                              │
  open the PR  ─────────────────────────────────────────────▶ extension
                                                              GET /walkthrough
                                                              renders the tour

  select code → "Ask"  ──▶  POST /ask  ──▶  channel event  ──▶  you answer
                            answer_question(id) ──▶ back to the modal
```

## Why this shape

- **Cheap & stable at runtime.** A spec is generated once per PR commit and
  cached. Opening the tour again costs nothing — no model call, no Claude.
- **No credentials.** PR data comes from `gh` (your existing auth); answers come
  from your running Claude session through the channel. No GitHub PAT, no API key.
- **Robust highlighting.** The extension highlights by GitHub's stable per-line
  anchors (with a text-match fallback), instead of scraping the live DOM.

## Quick start

1. **Server** — see `server/README.md`. Install deps, register it in `.mcp.json`,
   then launch Claude Code with the channel:
   `claude --dangerously-load-development-channels server:pr-walkthrough`
   (manually-configured MCP servers are tagged `server:`, not `plugin:`; the dev
   flag takes the entry directly and replaces `--channels` for non-allowlisted
   local channels). The HTTP bridge comes up on `http://localhost:8799`.
2. **Extension** — see `extension/README.md`. Load it unpacked in
   `chrome://extensions`.
3. In your Claude session: *"Build a walkthrough for <PR url>."* Claude calls
   `start_walkthrough`, authors the spec, and calls `publish_walkthrough`.
4. Open the PR's **Files** tab. Click the **▶ Walkthrough** button (bottom-left).
   Select any code and click **Ask about this** to ask questions.

## Status

v0.1 skeleton — end-to-end path is wired; expect rough edges. See each repo's
README for what's solid and what's still TODO.
