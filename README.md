# Kvasir

Kvasir turns code into an interactive, in-browser **walkthrough** on GitHub — a
guided tour that scrolls the diff (or jumps across files and repos), highlights the
lines that matter, and explains each one — plus a **select code → ask** modal for
on-the-spot questions. The content is authored once by your Claude Code session and
cached; the browser just renders it. Works on PR diffs **and** plain file/`blob`
pages, across one or many repos.

## Quick start

Prerequisites: the **claude** CLI and **gh** (`gh auth login` once). At runtime the
floor is just claude + gh + the `kvasir` binary.

1. **Install the extension** from the
   [Chrome Web Store](https://chromewebstore.google.com/detail/kvasir/pemfpcbcbfejhohpehohlnngaflpcden).
2. **Install the plugin** in Claude Code — it ships the `/kvasir` skill and installs
   the `kvasir` binary to `~/.local/bin` the next time you start Claude Code:
   ```
   /plugin marketplace add alex-yanchenko/kvasir
   /plugin install kvasir@kvasir
   ```
   Ensure `~/.local/bin` is on your `PATH`; update later with `/plugin marketplace update kvasir`.
3. **Start the channel** — run **`kvasir`** from any terminal. It opens a Claude Code
   session that serves the channel on `http://localhost:8799` (one instance per machine
   serves every tab). Leave it running.
4. **Pair** — open any GitHub PR → the **Kvasir** launcher → **Settings → Pair**, and
   approve the code in that session.

Then, on a PR's **Files** tab, click the **Kvasir** launcher → **Run walkthrough**. Two
depths (Settings → **Walkthrough depth**): **Heavy** (default) checks out the PR locally
and reads the surrounding code for context; **Light** authors from the `gh` diff alone.
**Select code → Ask** to ask questions in place. From any chat, the **`/kvasir`** skill
builds a walkthrough across your local repos and prints a link to open.

## Why this shape

- **Cheap.** Authoring a walkthrough and each Ask run in your Claude Code session and
  spend its quota — but the spec is cached (one per PR), so re-opening costs nothing and
  an idle channel spends nothing. No separate API key, no model billing of its own.
- **No credentials.** PR data comes from `gh` (your existing auth); answers come from
  your Claude session through the local channel. No GitHub PAT, no API key.
- **Robust.** The extension highlights by GitHub's stable per-line anchors (with a
  text-match fallback), not by scraping the live DOM.

## Why "Kvasir"

In Norse myth, Kvasir was the wisest of beings — wandering the world answering any
question put to him. That's what this does: wisdom from your Claude session, carried to
wherever you're reading code. The internals keep the same Norse world (Asgard, Midgard,
Bifrost, …) — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Contributing

Architecture, the component map, how it works, and the dev workflow are in
[CONTRIBUTING.md](CONTRIBUTING.md).
