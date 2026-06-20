# Kvasir

Kvasir turns code into an interactive, in-browser **walkthrough** on GitHub — a
guided tour that scrolls the diff (or jumps across files and repos), highlights
the lines that matter, and explains each one — plus a "select code and ask"
modal for on-the-spot questions. The smart content is authored once by your
Claude session and cached; the browser just renders it. Works on PR diffs **and**
plain file/`blob` pages, across one or many repos.

This started as a live demo (Claude driving a browser via the automation
extension) and was rebuilt into something stable, cheap, and credential-free.

## Why "Kvasir"

In Norse myth, **Kvasir** was the wisest of beings — he wandered the world
sharing knowledge and answering any question put to him. That is exactly what
this does: wisdom from your running Claude session, carried out to wherever
you're reading code, explaining it and answering questions _in place_.

The internals keep the same Norse world — Asgard, Midgard, Bifrost, Heimdall,
the ravens Huginn & Muninn, Mimir, the Runes (see [Components](#components)).
Kvasir is the wandering wisdom that sits **above** those realms and is the only
name you, the user, ever type. Fittingly, Kvasir draws from **Mimir**, the well
of wisdom — here, the local channel your Claude session answers through.

## Two flows

Both produce the same artifact — a stepped walkthrough rendered in Kvasir's
panel — and differ only in where the steps come from:

1. **PR tour (in-session).** In your Claude session: _"Build a walkthrough for
   `<PR url>`."_ Claude reads the diff via `gh`, authors a spec, and publishes it.
   Open the PR's **Files** tab and the panel renders the tour. Generated once per
   commit and cached — reopening costs nothing.

2. **Push / capture (from any chat).** After you've explained some code — often
   across several repos — run the **`/kvasir`** skill. It drafts the steps, the
   `kvasir build` builder resolves the verifiable parts (repo, commit sha, file
   existence, exact line numbers) and pushes, and you get a link. Opening it
   renders the same panel. Not tied to a single PR — spans repos and works on
   plain file pages.

On any open walkthrough: **select code → Ask** → your Claude session answers in
place, through the same channel.

## Components

A pnpm-workspaces monorepo. **Kvasir** is the umbrella (the product, the
`/kvasir` skill, the `kvasir` CLI, the channel on `:8799`). Beneath it, the parts
carry Norse names, used consistently in code and docs:

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

> The `@prw/*` package scope, `prw:` storage keys, and the `?prw=` link param are
> an internal prefix kept for compatibility (it predates the Kvasir name) — not
> user-facing.

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

> Setup note: register the channel in a local `.mcp.json` under the key
> **`kvasir`**, pointing at `packages/mimir/src/channel.ts` (this file is
> gitignored — it holds a machine-specific absolute path).

## How it works

```
  You (chat)                Claude Code session                 Chrome
  ──────────                ───────────────────                 ──────
  "build a walkthrough  ─▶  start_walkthrough(pr)  ──gh──▶  GitHub (PR diff)
   for <PR>"                author spec
                            publish_walkthrough(spec) ──▶  server cache
                                                              │
  open the PR  ─────────────────────────────────────────────▶ extension
                                                              GET /walkthrough
                                                              renders the tour

  select code → "Ask"  ──▶  POST /ask  ──▶  channel event  ──▶  you answer
                            answer_question(id) ──▶ back to the modal

  /kvasir (any chat)   ──▶  kvasir build → POST /push  ──▶  server cache
                            prints a ?prw= link → open it → same panel
```

## Why this shape

- **Cheap & stable at runtime.** A spec is generated once per PR commit and
  cached. Opening the tour again costs nothing — no model call, no Claude.
- **No credentials.** PR data comes from `gh` (your existing auth); answers come
  from your running Claude session through the channel. No GitHub PAT, no API key.
- **Robust highlighting.** The extension highlights by GitHub's stable per-line
  anchors (with a text-match fallback), instead of scraping the live DOM.

## Quick start

`./install.sh` installs the `/kvasir` skill globally, builds the extension, and
puts a **`kvasir`** command on your PATH. Then:

1. **Channel** — register it in your project `.mcp.json` under the key `kvasir`,
   pointing at `packages/mimir/src/channel.ts` (see `packages/mimir/README.md`),
   then run it:
   `kvasir` — which launches `claude --dangerously-load-development-channels server:kvasir`.
   The HTTP bridge comes up on `http://localhost:8799`.
2. **Extension** — load `packages/extension/` unpacked in `chrome://extensions`
   (Developer mode → Load unpacked). `pnpm --filter @prw/extension dev` rebuilds
   on save.
3. **PR tour:** in your Claude session, _"Build a walkthrough for `<PR url>`,"_
   then open the PR's **Files** tab and click the **▶ Kvasir** button.
   **Push from any chat:** run **`/kvasir`** and open the link it prints.
4. On any walkthrough, select code and click **Ask about this** to ask questions.

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
