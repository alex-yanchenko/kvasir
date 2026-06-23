# Changelog

## [0.3.0](https://github.com/alex-yanchenko/kvasir/compare/v0.2.1...v0.3.0) (2026-06-23)

The first feature release of Kvasir as a code-comprehension tool: a full in-page
redesign with a consolidated panel, whole-PR and per-step chat, a durable history
store, extension pairing, and review mode. Highlights below; this release also
folds in a large internal migration to a typed, React-based architecture.

### Features

**Panel & walkthrough**

- Consolidated in-page panel with **Walkthrough / Chat / History / Settings** tabs; open state and geometry persist across navigation and refresh.
- Wizard-style walkthrough navigation; step highlights persist across tab switches.
- Explainer-focused generation — re-aimed as an explainer rather than a reviewer, covering the whole PR, with an overview intro and step-lines gate ([#11](https://github.com/alex-yanchenko/kvasir/issues/11), [#12](https://github.com/alex-yanchenko/kvasir/issues/12)).
- Comprehension aids: coverage, outline, trail, and an optional flow diagram ([#6](https://github.com/alex-yanchenko/kvasir/issues/6)).

**Chat**

- Whole-PR chat and per-step chat, with multiple concurrent sessions via a session rail.
- Live-streamed answers (progress notes + partial text) and clickable code references; bare file mentions jump to the file's diff.
- Multiline input and recovery of a pending answer after a refresh.

**History**

- Durable SQLite store with a History tab listing PR and Code walkthroughs (PR number, author, search, reopen), consistent delete across tabs.

**Pairing & security**

- Pair the extension with the local bridge, code-confirmed through the session; paired sessions persist (hashed) across restarts.
- Token required on every call, with forced re-pair on 401; backend actions disabled while unpaired (no dead clicks).

**Review mode**

- Cross-repo review mailbox on the bridge; blob-page review with soft in-repo navigation (no reload, no blink) and a Reviews history tab.

**Install & branding**

- One-command setup that auto-wires `.mcp.json` and a unified `kvasir` launch; the launcher frees the single-owner `:8799` bridge before starting.
- Kvasir logo and toolbar/extension icons, a unified themed palette, and light/dark themes.

### Bug Fixes

- Theme now applies live instead of only on refresh; fixed dark-theme tokens not applying in the shadow root.
- Jump-to-code accuracy — shows the whole step range, is idempotent when already visible, and seats file jumps correctly under GitHub's sticky header and lazy layout.
- Pairing robustness — don't drop the token on a transient `/auth` failure; unpaired actions force pairing instead of failing silently.
- Security hardening — XSS in markdown/link URLs, path traversal in refs/file paths, and fencing of untrusted PR description/comment content.
- Streaming — partials render as markdown and the typing indicator stays up between real work.
- Open a generated walkthrough on its overview, and enable chat there ([#20](https://github.com/alex-yanchenko/kvasir/issues/20)).
- Persist panel size/position across refresh and regenerate; panel geometry is global, not per-PR.

## [0.2.1](https://github.com/alex-yanchenko/kvasir/compare/v0.2.0...v0.2.1) (2026-06-22)


### Continuous Integration

* automate version bumps + releases with release-please ([#13](https://github.com/alex-yanchenko/kvasir/issues/13)) ([d99146e](https://github.com/alex-yanchenko/kvasir/commit/d99146e4b1d628c6e24c5db9ff1366c83bf0b75b))
* prettier-ignore packages/extension/manifest.json (release-please reformats it) ([#18](https://github.com/alex-yanchenko/kvasir/issues/18)) ([0e2edbe](https://github.com/alex-yanchenko/kvasir/commit/0e2edbed4d3336a7d55543cc9b0e3b59f935f7b2))
* release on every commit type and prune stale drafts ([#14](https://github.com/alex-yanchenko/kvasir/issues/14)) ([3a593c9](https://github.com/alex-yanchenko/kvasir/commit/3a593c9fbf7547018de9a7832ebe26dbc4623554))
* scope release PR creation to a dedicated App token + serialize runs ([#16](https://github.com/alex-yanchenko/kvasir/issues/16)) ([a43d2b7](https://github.com/alex-yanchenko/kvasir/commit/a43d2b791ea4efc4b6f98696cb536365be3b4f4f))
