# Kvasir

Kvasir turns code into an interactive, in-browser **walkthrough** on GitHub — a
guided tour that scrolls the diff (or jumps across files and repos), highlights
the lines that matter, and explains each one — plus a "select code and ask"
modal for on-the-spot questions. The smart content is authored once by your
Claude session and cached; the browser just renders it. Works on PR diffs **and**
plain file/`blob` pages, across one or many repos.

This started as a live demo (Claude driving a browser via the automation
extension) and was rebuilt into something stable, cheap, and credential-free.

## Quick start

Prerequisites: **bun** (the installer runs under it), the **claude** CLI, and
**gh** (run `gh auth login` once — PR data needs it). The channel ships as a
standalone binary: with the repo's dependencies installed, the installer compiles
it; otherwise (e.g. a no-pnpm clone, where there's nothing to resolve the channel's
imports against) it downloads the prebuilt binary for your platform from the latest
release. Either way, at runtime the floor is just **claude + gh + the binary** (no
`node_modules`). **pnpm** is only needed to build the extension from source; without
it the installer downloads the prebuilt extension from the latest release. Then,
from the repo root:

```bash
./install.sh
```

That installs the `/kvasir` skill, sets up the extension (builds it with pnpm or
downloads the prebuilt bundle), **compiles (or
downloads) the channel binary** into `~/.kvasir/bin` and **registers it in
`.mcp.json`**, and puts a **`kvasir`** command on your PATH. (Add `--allow-push` to
also skip the per-push permission prompt.)

Three one-time steps:

1. **Load the extension** — `chrome://extensions` → enable **Developer mode** →
   **Load unpacked** → select `packages/extension/`.
2. **Start the channel** — run **`kvasir`** from anywhere. It opens a Claude Code
   session that serves the channel (one instance per machine serves every browser
   tab; the bridge listens on `http://localhost:8799`). Leave it running.
3. **Pair** — open any GitHub PR, click the **Kvasir** launcher → **Settings →
   Pair**, and approve the code in that session.

Then make a walkthrough — you drive it from the extension, not the terminal:

- **From a PR:** open the PR's **Files** tab, click the **Kvasir** launcher, and hit
  **Run review**. The panel asks your running session to generate the walkthrough and
  renders it; **Regenerate/Update** live in the panel too. Two depths (Settings →
  **Review depth**): **Heavy** (default) checks out the PR's local clone — a throwaway
  worktree at the PR head — and reads the surrounding code so the review reasons about
  correctness, not just the diff; **Light** authors from the PR diff alone via `gh`
  (no checkout). Heavy looks for the repo under your **Local repos root** (default
  `~/code`) and silently falls back to Light if it isn't there.
- **From any chat (cross-repo):** after you've explained code across one or more
  **locally-cloned** repos, run the **`/kvasir`** skill — it builds the walkthrough
  from those repos on disk and prints a link to open.

On any walkthrough, **select code → Ask** to ask questions in place.

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

1. **PR tour (from the panel).** Open the PR's **Files** tab and click **Run review**
   in the Kvasir panel. That asks your running session to read the PR, author a spec,
   and publish it. **Review depth** (Settings) decides how much it reads: **Heavy**
   (default) adds a local-repo pass — it finds the clone under your **Local repos root**
   (default `~/code`), adds a worktree at the PR head, and reads callers / called
   definitions / types to judge correctness, then removes the worktree; if the repo
   isn't found it falls back to **Light**, which authors from the `gh` diff alone.
   Heavy needs `git` and the repo cloned locally. Generated once per commit and cached,
   so reopening costs nothing. (You can also just ask the session _"Build a walkthrough
   for `<PR url>`"_ by hand, but the button is the point.) After it publishes, the panel's
   **Copy build log** button grabs _how_ it was built — the change/coverage facts plus the
   session's own rationale (for heavy: what it read, any correctness concerns) — to paste
   for a quality review. It's also saved under `~/.kvasir/logs/`, so any session can read it
   when you ask _"how was this walkthrough built?"_.

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

| Name         | Is                                                                                                                | Why                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Asgard**   | `extension/src/content/asgard/` — the React panel app (launcher, tour, chat, settings) in a shadow root           | realm of the gods — never touches the mortal page                      |
| **Midgard**  | `extension/src/content/midgard/` — the imperative page controller; everything coupled to GitHub's diff DOM        | the mortal realm — the code that lives in the page                     |
| **Bifrost**  | `extension/src/content/bifrost.ts` — the typed bridge (commands · reports · queries); DOM nodes never cross       | the only way between realms                                            |
| **Heimdall** | `extension/src/content/heimdall/` — boot + per-PR restore + the SPA URL watcher                                   | the all-seeing watchman of the Bifrost                                 |
| **Huginn**   | `extension/src/huginn.ts` — the background service worker (fetch proxy to Mimir)                                  | Odin's thought-raven: flies out, returns with tidings                  |
| **Muninn**   | `extension/src/content/muninn.ts` — the chrome.storage wrapper                                                    | the memory-raven: remembers                                            |
| **Mimir**    | `packages/mimir` — `@kvasir/mimir`, the Claude Code channel + localhost bridge (Bun)                              | the well of wisdom the extension consults; your Claude session answers |
| **Runes**    | `packages/runes` — `@kvasir/runes`, the pure shared contract (spec types, PR-URL parsing, diff anchors, markdown) | the shared symbols every realm can read                                |

One sentence holds the system: _Asgard never touches the page; a question
crosses the Bifrost; Huginn carries it to Mimir; Muninn remembers; Heimdall
watches the URL; all realms share the Runes._

> The `@kvasir/*` package scope, `kvasir:` storage keys, and the `?kvasir=` link param are
> an internal prefix kept for compatibility (it predates the Kvasir name) — not
> user-facing.

```
kvasir/
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
                            prints a ?kvasir= link → open it → same panel
```

## Why this shape

- **Cheap & stable at runtime.** A spec is generated once per PR commit and
  cached. Opening the tour again costs nothing — no model call, no Claude.
- **No credentials.** PR data comes from `gh` (your existing auth); answers come
  from your running Claude session through the channel. No GitHub PAT, no API key.
- **Robust highlighting.** The extension highlights by GitHub's stable per-line
  anchors (with a text-match fallback), instead of scraping the live DOM.

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

The React migration ("the Nine Realms") is complete: the panel UI is a React app
in a shadow root, the page controller is imperative Midgard, and everything
between them crosses the typed Bifrost. Known gap: jump-to-line can miss on some
diff rows — the side-aware fix needs ground-truth GitHub markup.
