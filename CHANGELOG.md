# Changelog

## [0.5.0](https://github.com/alex-yanchenko/kvasir/compare/v0.4.0...v0.5.0) (2026-07-13)


### Features

* **asgard:** review-mode parity — outline rail, visited dots, arrow keys, chat persistence fix ([#51](https://github.com/alex-yanchenko/kvasir/issues/51)) ([3a46ab6](https://github.com/alex-yanchenko/kvasir/commit/3a46ab66c9622c4d38e9ff41ab83911970892349))
* **mimir:** channel robustness — persisted PR manifests, one sqlite connection ([#53](https://github.com/alex-yanchenko/kvasir/issues/53)) ([b664770](https://github.com/alex-yanchenko/kvasir/commit/b66477014c3cee857d5f68ea18019a898bebc304))


### Bug Fixes

* **asgard:** stop sub-pixel phantom scroll room leaking wheels to the page ([#49](https://github.com/alex-yanchenko/kvasir/issues/49)) ([55f5b20](https://github.com/alex-yanchenko/kvasir/commit/55f5b20c0eab20660aea7713537406f559484499))
* **release:** publish releases directly instead of parking a tagless draft ([#48](https://github.com/alex-yanchenko/kvasir/issues/48)) ([5174868](https://github.com/alex-yanchenko/kvasir/commit/517486889ffe2c2c6545c02a705b00e5f7db27ff))
* sweep review leftovers — vet round on PRs 46/48/49 + deferred findings ([#50](https://github.com/alex-yanchenko/kvasir/issues/50)) ([eb8c1e7](https://github.com/alex-yanchenko/kvasir/commit/eb8c1e79a3a02b2089d8b1afc18d80a54be5c781))


### Code Refactoring

* **asgard:** state consolidation — machine slices on the store + one persistence module ([#54](https://github.com/alex-yanchenko/kvasir/issues/54)) ([87fbe61](https://github.com/alex-yanchenko/kvasir/commit/87fbe61599c47bce7227135b486268fcfddb82d1))

## [0.4.0](https://github.com/alex-yanchenko/kvasir/compare/v0.3.0...v0.4.0) (2026-07-09)


### Features

* **asgard:** add a connection tri-state (channel down / unpaired / paired) ([#35](https://github.com/alex-yanchenko/kvasir/issues/35)) ([51e8c75](https://github.com/alex-yanchenko/kvasir/commit/51e8c75347890c2de3c16623ea17c9a41ea1dff3))
* **asgard:** Escape closes the panel; visited dots survive a reload ([#40](https://github.com/alex-yanchenko/kvasir/issues/40)) ([b056fbc](https://github.com/alex-yanchenko/kvasir/commit/b056fbc2813d7cd625c38dfcb2ef894626f7018d))
* **asgard:** group walkthrough outline steps into logical phases ([#26](https://github.com/alex-yanchenko/kvasir/issues/26)) ([6c0a4a4](https://github.com/alex-yanchenko/kvasir/commit/6c0a4a4025fe1d50643e82806d4b894264ca4266))
* **asgard:** replace the step background tint with a left rail (+ rail+gutter option) ([#32](https://github.com/alex-yanchenko/kvasir/issues/32)) ([153d69e](https://github.com/alex-yanchenko/kvasir/commit/153d69e718b29d93e8cb2dc1f90fdd5392c71cec))
* **asgard:** show the step count on the walkthrough overview ([#25](https://github.com/alex-yanchenko/kvasir/issues/25)) ([de8f5a9](https://github.com/alex-yanchenko/kvasir/commit/de8f5a9261b7020976ab538dc76befaf07f407fd))
* **asgard:** smoother diff navigation for incremental review ([#23](https://github.com/alex-yanchenko/kvasir/issues/23)) ([df8295b](https://github.com/alex-yanchenko/kvasir/commit/df8295bd3ed7ed66bc932764a36cada24ad929fd))
* **mimir:** worktree MCP tools — heavy-pass git ops become code, not prompt ([#44](https://github.com/alex-yanchenko/kvasir/issues/44)) ([5b3f822](https://github.com/alex-yanchenko/kvasir/commit/5b3f822bc794f4878533da09235484a77479c42b))


### Bug Fixes

* **asgard:** cache-first spec load — no empty-state flash, loading is not none ([#38](https://github.com/alex-yanchenko/kvasir/issues/38)) ([68dbfb1](https://github.com/alex-yanchenko/kvasir/commit/68dbfb14d61022db652c183b560663c645208483))
* **asgard:** give every silent failure path words ([#36](https://github.com/alex-yanchenko/kvasir/issues/36)) ([d5a122a](https://github.com/alex-yanchenko/kvasir/commit/d5a122a2f953512900238b3d820e9b88f1b71d02))
* **asgard:** hide the outline while generating so stale steps aren't clickable ([#28](https://github.com/alex-yanchenko/kvasir/issues/28)) ([1fb126a](https://github.com/alex-yanchenko/kvasir/commit/1fb126a1ef90fad7e09bb1c123045f0e5466aef0))
* **asgard:** highlight a modification's removed lines, not just the added half ([#31](https://github.com/alex-yanchenko/kvasir/issues/31)) ([fa8665a](https://github.com/alex-yanchenko/kvasir/commit/fa8665a16edca92e685e55cd2809cc9fb31e29e3))
* **asgard:** make Escape reach the regen dialog, pin visited dots to their spec, re-sync the tour on spec swap ([#41](https://github.com/alex-yanchenko/kvasir/issues/41)) ([82f5b58](https://github.com/alex-yanchenko/kvasir/commit/82f5b58b91d9b877d7aada5e5a1318736b989227))
* **asgard:** persist panel shape globally + open at a larger default size ([#30](https://github.com/alex-yanchenko/kvasir/issues/30)) ([ecacc3b](https://github.com/alex-yanchenko/kvasir/commit/ecacc3b09702acfe15b1dff6205cbc80d76dbe77))
* **asgard:** restore chat styling by aligning class names to the stylesheet ([#34](https://github.com/alex-yanchenko/kvasir/issues/34)) ([33c2474](https://github.com/alex-yanchenko/kvasir/commit/33c24749baa29d5de8ae3ef516e692bfd156dd14))
* **asgard:** tidy walkthrough output and relocate the changes-since-review button ([#24](https://github.com/alex-yanchenko/kvasir/issues/24)) ([d0a7422](https://github.com/alex-yanchenko/kvasir/commit/d0a74226f4e16be04e966457964939243c3ab214))
* call the generated artifact a walkthrough everywhere + correct stale claims ([#37](https://github.com/alex-yanchenko/kvasir/issues/37)) ([8c5dc86](https://github.com/alex-yanchenko/kvasir/commit/8c5dc866d9ead8f8240645ba323403da55d67b82))
* highlight removed-line walkthrough steps (thread diff side) ([#29](https://github.com/alex-yanchenko/kvasir/issues/29)) ([6c18dca](https://github.com/alex-yanchenko/kvasir/commit/6c18dcacdc69635e137885fc30532e3d72d15e3f))
* **mimir:** stop heavy-pass shallow-fetching the user's clone ([#43](https://github.com/alex-yanchenko/kvasir/issues/43)) ([5199ce3](https://github.com/alex-yanchenko/kvasir/commit/5199ce37b5393c245897c30ecc281ed7c275e4ed))
* security hardening — injection fence, destructive-wipe gating, installer provenance ([#33](https://github.com/alex-yanchenko/kvasir/issues/33)) ([af46e94](https://github.com/alex-yanchenko/kvasir/commit/af46e94a702f17d89445d73be942c4de7456d13e))


### Performance Improvements

* **heimdall:** react to SPA navigation events instead of waiting out a poll tick ([#39](https://github.com/alex-yanchenko/kvasir/issues/39)) ([3df1148](https://github.com/alex-yanchenko/kvasir/commit/3df1148c086f49a2b5c01599ff25bfb17756b5c2))


### Code Refactoring

* one step core + one guide text pipeline (plan 7.1, wire unchanged) ([#45](https://github.com/alex-yanchenko/kvasir/issues/45)) ([ded9498](https://github.com/alex-yanchenko/kvasir/commit/ded9498aae1aef5e75d34cd329878764d061d1ea))
* retire prior-shape data instead of carrying back-compat ([#27](https://github.com/alex-yanchenko/kvasir/issues/27)) ([48c6d44](https://github.com/alex-yanchenko/kvasir/commit/48c6d44cbe26667cad01340e89ad9ac018f60846))

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
