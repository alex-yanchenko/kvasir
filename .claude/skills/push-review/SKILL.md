---
name: push-review
description: Push the current AI research/explanation into the PR-Walkthrough browser extension as a clickable, multi-repo code walkthrough. Use when the user says "push this to the extension", "send this review to the browser", "open this in pr-walkthrough", or after explaining code across one or more repos and wanting to walk it visually in GitHub. Works from ANY Claude Code session — it just needs the local PR-Walkthrough channel running on :8799.
---

# Push a review to the extension

Turn the explanation you just produced into a **review** and push it. You supply
the judgment (which files, which code, the prose); a deterministic builder
(`prw-build-review`) resolves the verifiable parts — repo, commit sha, file
existence, exact line numbers — and pushes. **You never write line numbers,
URLs, or the final JSON**, so a wrong path or guessed line can't 404 a link.

The mailbox is one shared local server (`localhost:8799`) owned by whichever
session runs `claude-pr-walkthrough`; ANY session can push to it.

## 1. Write a draft

One step per distinct thing you explained. For each step, you only provide:

- `repoDir` — local path to the repo on disk (e.g. `~/code/your-org/your-frontend`).
- `file` — repo-relative path of the code (the builder verifies it exists).
- `locator` — **how to find the lines, by VERBATIM snippet you actually read** (not
  line numbers): `{ "from": "<a unique line in the region>", "to": "<the last
  line of the region>" }`. `to` is optional (single line). The builder greps
  these in the file → real line numbers. Quote real text — if it's not in the
  file, the build fails loudly (which means you had the wrong file/snippet).
  - Escape hatch: `{ "lines": { "start": N, "end": M } }` if you genuinely have
    exact numbers, but the snippet form is preferred — it can't be wrong.
- `title` — short step title.
- `body` — CONCISE summary (1-3 sentences), shown by default.
- `detail` — the in-depth part shown on "Show details": edge cases, rationale,
  gotchas, how it connects to other steps. Author it whenever there's depth.
- `highlight?` / `suggestions?` — optional.

Write it to a temp file, e.g. `/tmp/prw-draft.json`:

```json
{
  "title": "Auth: Auth0 OIDC across web + API",
  "source": "Claude research chat",
  "steps": [
    {
      "repoDir": "~/code/your-org/your-frontend",
      "file": "<the real path you read>",
      "locator": { "from": "export default handleAuth(", "to": "});" },
      "title": "Auth0 catch-all route",
      "body": "The SDK's login/logout/callback/me handler.",
      "detail": "offline_access enables silent refresh; the SDK persists the session in a secure cookie after Auth0 redirects back to the callback."
    },
    {
      "repoDir": "~/code/your-org/your-backend",
      "file": "<the real path you read>",
      "locator": { "from": "@UseGuards(", "to": "}" },
      "title": "Backend token verification",
      "body": "The API re-validates the access token on protected routes.",
      "detail": "..."
    }
  ]
}
```

Steps may span repos freely — that's the point for full-stack explanations.

## 2. Build + push

```bash
prw-build-review /tmp/prw-draft.json
```

It resolves owner/name + head sha (`git`), verifies each file exists at that sha,
greps your locator snippets for the real line range, validates the shape, pushes
to the mailbox, and prints the **link**. (If `prw-build-review` isn't on PATH, run
it directly: `bun run <pr-walkthrough>/packages/mimir/scripts/buildReview.ts /tmp/prw-draft.json`.)

## 3. Hand the user the link

Print the URL it output. The user opens it; the extension reads `?prw=<id>`, pulls
the review, and walks the steps — jumping across repos/files, GitHub highlighting
each line range, with body + "Show details" per step.

## If it fails (the builder tells you exactly which)

- **`file not found at <sha>: <path>`** → you had the wrong path/repo. Find the
  real file (`git -C <repoDir> ls-files | grep ...`) and fix `file`.
- **`locator.from not found`** → the snippet isn't in that file verbatim. Re-read
  the file and quote a real line.
- **`cannot reach the mailbox on :8799`** → the daemon isn't running. Tell the
  user to start `claude-pr-walkthrough`.
