# Contributing to Kvasir

## From source

With **bun** installed, clone the repo and run **`pnpm kvasir-setup`** — it compiles the
binary, builds (or downloads) the extension, installs the skills into `~/.claude/skills`,
and registers the channel. `pnpm kvasir-setup -- --help` for options (`--allow-push` also
skips the per-push permission prompt).

To load the extension unpacked (from source or a pre-release build): grab
`kvasir-extension.zip` from the [latest release](https://github.com/alex-yanchenko/kvasir/releases)
and unzip it — or use `packages/extension/` from a clone — then `chrome://extensions` →
enable **Developer mode** → **Load unpacked** → select that folder.

## Components

A pnpm-workspaces monorepo. **Kvasir** is the umbrella (the product, the `/kvasir` skill,
the `kvasir` CLI, the channel on `:8799`). Beneath it, the parts carry Norse names, used
consistently in code and docs:

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

One sentence holds the system: _Asgard never touches the page; a question crosses the
Bifrost; Huginn carries it to Mimir; Muninn remembers; Heimdall watches the URL; all
realms share the Runes._

> The `@kvasir/*` package scope, `kvasir:` storage keys, and the `?kvasir=` link param are
> an internal prefix kept for compatibility (it predates the Kvasir name) — not
> user-facing.

```
kvasir/
├── packages/
│   ├── runes/       Pure shared contract (zod-validated): spec types, PR-URL parsing,
│   │                diff anchors, markdown rendering (imported by Mimir + extension)
│   ├── mimir/       Claude Code channel + localhost HTTP bridge (Bun + TypeScript)
│   └── extension/   Chrome MV3 extension (React in a shadow root), bundled with
│                    esbuild → dist/. All GitHub-diff-DOM coupling is isolated
│                    in content/midgard/
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

The two sides are decoupled by a single contract: the **walkthrough spec** (see
`packages/runes/src/spec.ts`). Mimir produces and serves specs; the extension consumes
them. Either side can change independently.

> How the channel is wired: `kvasir run` writes a self-referencing MCP config to
> `~/.kvasir/mcp.json` (pointing the `kvasir` server at the installed binary's `channel`
> subcommand) and hands it to Claude via `--mcp-config`, so no repo directory or project
> `.mcp.json` is touched. Running from source is the one exception — contributors register
> `packages/mimir/src/main.ts channel` in a local, gitignored `.mcp.json` instead (see
> `packages/mimir/README.md`).

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

The generated artifact is always a **walkthrough** — an explainer, not a code review. The
conversation side (Ask, chat, suggested questions) is deliberately **reviewer-voiced**:
you're usually on a PR deciding whether to approve, so the chat serves that decision.

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

CI (`.github/workflows/ci.yml`) runs format:check → lint → typecheck → test:coverage →
build on every push and PR.

Coverage is gated per realm (vitest.config.ts): **Asgard, the Bifrost, Heimdall, Muninn
and the key builders at 100%** (lines/branches/functions/statements — no coverage-ignore
comments), **Midgard at ≥90%** (fixture-driven jsdom tests).
