---
name: push-review
description: Push the current AI research/explanation into the PR-Walkthrough browser extension as a clickable, multi-repo code walkthrough. Use when the user says "push this to the extension", "send this review to the browser", "open this in pr-walkthrough", or after explaining code across one or more repos and wanting to walk it visually in GitHub. Works from ANY Claude Code session — it just needs the local PR-Walkthrough channel running on :8799.
---

# Push a review to the extension

Turn the explanation you just produced into a **Review** and POST it to the local
PR-Walkthrough mailbox. The mailbox is one shared local server (`localhost:8799`)
owned by whichever session runs `claude-pr-walkthrough`; ANY session can push to
it — you do not need to own the bridge or be paired.

## 1. Build the Review JSON

One step per distinct thing you explained. Each step pins **real code** so the
extension can jump to it. The blob link 404s if the path/ref is wrong, so
**ground every locating field in the actual repo — never infer a path:**

- `repo.owner` / `repo.name` — from the repo's GitHub remote. Per repo:
  `git -C <repo-dir> remote get-url origin` → parse `owner/name`.
- `ref` — a branch or commit that ACTUALLY CONTAINS the file. Default to the
  checked-out commit sha (`git -C <repo-dir> rev-parse HEAD`) so the link is
  stable, or the branch name if you confirmed the file is on it.
- `file` — repo-relative path. **Verify it exists at that ref before adding the
  step:** `git -C <repo-dir> ls-files --error-unmatch <path>` (or
  `gh api repos/<owner>/<name>/contents/<path>?ref=<ref>`). If it doesn't
  resolve, fix the path — do not ship a step whose file you haven't confirmed.
- `lines` — the `{start,end}` line range to highlight (the new/right side),
  read from the real file (not guessed).
- `body` — a CONCISE summary (1-3 sentences): what this code does / why it
  matters. Shown by default. Full prose, user-facing.
- `detail` — the in-depth part shown on "Show details": edge cases, rationale,
  gotchas, how it connects to other steps. Author this whenever there's depth
  beyond the one-line summary (most steps deserve it) — body is the headline,
  detail is the substance.
- `highlight?` — fallback substrings. `suggestions?` — follow-up questions.

Shape (the wire contract is `@prw/runes` `ReviewSchema` — server validates it and
returns the exact failing field if anything's off):

```json
{
  "version": 1,
  "title": "Auth flow across web + api",
  "source": "Claude research chat",
  "steps": [
    {
      "id": "guard",
      "title": "Route guard rejects unpaired callers",
      "body": "The guard checks the token before any handler runs…",
      "repo": { "owner": "your-org", "name": "your-frontend" },
      "ref": "main",
      "file": "src/auth/guard.ts",
      "lines": { "start": 10, "end": 24 }
    },
    {
      "id": "server-check",
      "title": "Matching server-side validation",
      "body": "The backend re-validates the same token…",
      "repo": { "owner": "your-org", "name": "your-backend" },
      "ref": "main",
      "file": "src/api/auth.controller.ts",
      "lines": { "start": 40, "end": 55 }
    }
  ]
}
```

Steps may span repos freely — that's the point for full-stack explanations.

## 2. Push it

Write the JSON to a temp file and POST it (avoids shell-escaping a big payload):

```bash
curl -fsS localhost:8799/push \
  -H 'x-pr-walkthrough: 1' -H 'content-type: application/json' \
  -d @/tmp/prw-review.json
```

The response is `{ "id": "...", "url": "https://github.com/.../blob/...?prw=..." }`.

## 3. Hand the user the link

Print the `url` from the response. The user opens it; the extension reads
`?prw=<id>` off the URL, pulls the review from the mailbox, and walks the steps —
jumping across the repos/files and highlighting each line range.

## If the push fails

- **Connection refused** → the mailbox isn't running. Tell the user to start it:
  `claude-pr-walkthrough` (in a terminal). It's single-owner; one instance serves
  every session.
- **400 with field paths** (e.g. `steps.0.lines: expected object`) → fix that
  field in the JSON and re-push. The server names exactly what's wrong.
