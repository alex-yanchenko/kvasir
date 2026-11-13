# Chrome Web Store listing

Text and images for the Chrome Web Store developer dashboard, kept here so every submission uses the same listing. The store item is [pemfpcbcbfejhohpehohlnngaflpcden](https://chromewebstore.google.com/detail/kvasir/pemfpcbcbfejhohpehohlnngaflpcden).

## Store listing

**Name:** Kvasir

**Summary:** the `description` in `packages/extension/manifest.json`, which the store reads from each uploaded package (132 characters at most):

> Guided walkthroughs of GitHub pull requests in your browser, written by your Claude Code session. Select any code and ask about it.

**Category:** Developer Tools

**Language:** English

**Description:**

```
Kvasir turns a GitHub pull request into a guided walkthrough. It scrolls the diff, highlights the lines that matter in each step, and explains them, in a panel beside the code. Select any lines and ask a question about them in place.

Your own Claude Code session writes the walkthrough and answers the questions. The extension only shows them.

- Works on a pull request's Files tab and on plain file pages, and a walkthrough can span several repositories.
- Two depths: Heavy checks out the pull request and reads the code around the change; Light works from the diff alone.
- Written once per pull request and cached, so opening it again costs nothing.
- No account, no API key, no Kvasir server. The extension talks only to the kvasir program on your own machine (http://localhost:8799), which uses your Claude Code session and your gh login.
- Open source: https://github.com/alex-yanchenko/kvasir

Kvasir needs the kvasir command-line tool and Claude Code. Setup takes two commands; see the README on GitHub.
```

## Images

All of them are generated; see "Images" in the README.

| Dashboard field                       | File                                                                                              | Made by                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Store icon (128×128)                  | `packages/extension/icons/icon-128.png`                                                           | `pnpm icons`, from `packages/extension/icons/kvasir-icon.svg` |
| Screenshots (1280×800), in this order | `docs/images/store-walkthrough.png`, `docs/images/store-outline.png`, `docs/images/store-ask.png` | `pnpm screenshots`                                            |
| Small promo tile (440×280)            | `docs/images/promo-small.png`                                                                     | `pnpm screenshots`                                            |
| Marquee promo tile (1400×560)         | `docs/images/promo-marquee.png`                                                                   | `pnpm screenshots`                                            |
