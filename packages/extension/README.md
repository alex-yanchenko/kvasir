# Kvasir extension

A Chrome MV3 extension that renders Claude-authored walkthroughs on GitHub PR
pages and provides a select-code-and-ask modal. No Web Store needed — load it
unpacked.

## What it does

- On a PR's **Files** page, shows a **▶ Kvasir** launcher (bottom-left).
  Clicking it steps through the walkthrough: scrolls to each file, highlights the
  relevant lines, and shows a card with Back / Next (arrow keys and Esc work too).
- Highlights using GitHub's per-line anchors when the spec provides line ranges,
  falling back to text matching.
- Select any code in the diff → an **Ask about this** pill appears → opens an
  animated modal with suggested questions (chips) and a free-text box. Answers
  come from your Claude session via the local channel.

## Load it

1. Start the channel (see `../mimir/README.md`) — e.g. `kvasir` — so `http://localhost:8799` is up.
2. Go to `chrome://extensions`, enable **Developer mode** (top-right).
3. Click **Load unpacked** and select this `extension/` folder.
4. Open a GitHub PR's **Files** tab. The launcher appears bottom-left.

## How it talks to the server

Content scripts are subject to the page's CORS, so all calls go through the
background service worker (`src/huginn.ts`), which has `host_permissions` for
`localhost:8799` and fetches cross-origin freely.

If you change the server port, update `PORT` in both `src/huginn.ts` and the
`host_permissions` entry in `manifest.json`, then reload the extension.

## Files

| File / dir                      | Role                                                                 |
| ------------------------------- | -------------------------------------------------------------------- |
| `manifest.json`                 | MV3 manifest; matches `github.com/*/*/pull/*`                        |
| `src/huginn.ts`                 | fetch proxy to the local server                                      |
| `src/content/index.tsx`         | entry → `heimdall/boot.tsx` (realm wiring, shadow root, React mount) |
| `src/content/asgard/`           | the React panel app (launcher, tour card, chat, settings, tooltips)  |
| `src/content/midgard/`          | the page controller: diff readers, highlights, grip/ask bar, jumps   |
| `src/content/bifrost.ts`        | the typed bridge between Asgard and Midgard                          |
| `src/content/heimdall/`         | boot glue + per-PR restore + the SPA URL watcher                     |
| `src/midgard.css`               | light-DOM styles (grip, ask bar, row highlights — prefixed `kvasir-`)   |
| `src/content/asgard/asgard.css` | panel styles, injected into the shadow root                          |

## Known rough edges (v0.1)

- GitHub lazy-renders large diffs; a file behind a "Load diff" button may not
  highlight until expanded. The tour scrolls to it first, which usually triggers
  render.
- SPA navigation is detected by polling the URL every 1.5s — fine, not instant.
- Line-anchor element ids vary across GitHub's diff views; the text-match
  fallback covers the gaps.
