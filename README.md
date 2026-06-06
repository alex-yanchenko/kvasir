# PR Walkthrough

Turn a GitHub PR into an interactive, in-browser walkthrough — a guided tour that
scrolls the diff, highlights the lines that matter, and explains each one — plus
a "select code and ask" modal for on-the-spot questions. The smart content is
generated once by Claude and cached; the browser just renders it.

This started as a live demo (Claude driving a browser via the automation
extension) and was rebuilt into something stable, cheap, and credential-free.

## Layout

A pnpm-workspaces monorepo. The parts carry Norse names, used consistently in
code and docs:

| Name         | Is                                                                                                             | Why                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Asgard**   | `extension/src/content/asgard/` — the React panel app (launcher, tour, chat, settings) in a shadow root        | realm of the gods — never touches the mortal page                      |
| **Midgard**  | `extension/src/content/midgard/` — the imperative page controller; everything coupled to GitHub's diff DOM     | the mortal realm — the code that lives in the page                     |
| **Bifrost**  | `extension/src/content/bifrost.ts` — the typed bridge (commands · reports · queries); DOM nodes never cross    | the only way between realms                                            |
| **Heimdall** | `extension/src/content/heimdall/` — boot + per-PR restore + the SPA URL watcher                                | the all-seeing watchman of the Bifrost                                 |
| **Huginn**   | `extension/src/huginn.ts` — the background service worker (fetch proxy to Mimir)                               | Odin's thought-raven: flies out, returns with tidings                  |
| **Muninn**   | `extension/src/content/muninn.ts` — the chrome.storage wrapper                                                 | the memory-raven: remembers                                            |
| **Mimir**    | `packages/mimir` — `@prw/mimir`, the Claude Code channel + localhost bridge (Bun)                              | the well of wisdom the extension consults; your Claude session answers |
| **Runes**    | `packages/runes` — `@prw/runes`, the pure shared contract (spec types, PR-URL parsing, diff anchors, markdown) | the shared symbols every realm can read                                |

One sentence holds the system: _Asgard never touches the page; a question
crosses the Bifrost; Huginn carries it to Mimir; Muninn remembers; Heimdall
watches the URL; all realms share the Runes._

```
pr-walkthrough/
├── packages/
│   ├── runes/       Pure, dependency-free contract: spec types, PR-URL parsing,
│   │                diff anchors, markdown rendering (imported by Mimir + extension)
│   ├── mimir/       Claude Code channel + localhost HTTP bridge (Bun + TypeScript)
│   └── extension/   Chrome MV3 extension (React in a shadow root), bundled with
│                    esbuild → dist/. All GitHub-diff-DOM coupling is isolated
│                    in content/midgard/
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

The two sides are decoupled by a single contract: the **walkthrough spec** (see
`packages/runes/src/spec.ts`). Mimir produces and serves specs; the extension
consumes them. Either side can change independently.

> Setup note: register the channel in a local `.mcp.json` pointing at
> `packages/mimir/src/channel.ts` (this file is gitignored — it holds a
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

1. **Server** — see `packages/mimir/README.md`. Install deps, register it in `.mcp.json`,
   then launch Claude Code with the channel:
   `claude --dangerously-load-development-channels server:pr-walkthrough`
   (manually-configured MCP servers are tagged `server:`, not `plugin:`; the dev
   flag takes the entry directly and replaces `--channels` for non-allowlisted
   local channels). The HTTP bridge comes up on `http://localhost:8799`.
2. **Extension** — see `extension/README.md`. Build it once with `pnpm build`
   (the manifest points at `dist/`), then load `packages/extension/` unpacked in
   `chrome://extensions`. Use `pnpm --filter @prw/extension dev` to rebuild on save.
3. In your Claude session: _"Build a walkthrough for <PR url>."_ Claude calls
   `start_walkthrough`, authors the spec, and calls `publish_walkthrough`.
4. Open the PR's **Files** tab. Click the **▶ Walkthrough** button (bottom-left).
   Select any code and click **Ask about this** to ask questions.

## Develop

From the repo root (pnpm workspaces):

```
pnpm install        # install all workspace deps
pnpm test           # Vitest, run once from the root (not per-package)
pnpm test:coverage  # the same suite + the coverage gates (Asgard 100%)
pnpm typecheck      # tsc --noEmit across runes / mimir / extension
pnpm lint           # ESLint (flat config)
pnpm format         # Prettier --write
pnpm build          # bundle the extension → packages/extension/dist/
```

CI (`.github/workflows/ci.yml`) runs format:check → lint → typecheck →
test:coverage → build on every push and PR.

Coverage is gated per realm (vitest.config.ts): **Asgard, the Bifrost, Heimdall,
Muninn and the key builders at 100%** (lines/branches/functions/statements — no
coverage-ignore comments), **Midgard at ≥90%** (fixture-driven jsdom tests).

## Status

The React migration ("the Nine Realms", MIGRATION.md) is complete: the panel UI
is a React app in a shadow root, the page controller is imperative Midgard, and
everything between them crosses the typed Bifrost. Content bundle: ~250 KB raw /
~76 KB gzipped (React included). Known gap: jump-to-line can miss on some diff
rows — the side-aware fix needs ground-truth GitHub markup (MIGRATION.md, A2).
