---
name: kvasir
description: Turn the code you've just explained into a Kvasir walkthrough — a clickable, multi-repo tour rendered on GitHub — and push it. Use when the user says "make a walkthrough", "push this to the browser", "show this in Kvasir", "walk me through this on GitHub", or after explaining code across one or more repos and wanting to walk it visually. Works from ANY Claude Code session — it just needs the local Kvasir channel running on :8799.
---

# Push a walkthrough to Kvasir

Turn the explanation you just produced into a **walkthrough** and push it. You
supply the judgment (which files, which code, the prose); a deterministic builder
(`kvasir build`) resolves the verifiable parts — repo, commit sha, file existence,
exact line numbers — and pushes. **You never write line numbers, URLs, or the
final JSON**, so a wrong path or guessed line can't 404 a link.

The mailbox is one shared local server (`localhost:8799`) owned by whichever
session runs `kvasir`; ANY session can push to it.

## 1. Write a draft

One step per distinct thing you explained. For each step, you only provide:

- `repoDir` — local path to the repo on disk (e.g. `~/code/your-frontend`).
- `file` — repo-relative path of the code (the builder verifies it exists).
- `locator` — **how to find the lines, by VERBATIM snippet you actually read** (not
  line numbers): `{ "from": "<a unique line in the region>", "to": "<the last
line of the region>" }`. `to` is optional (single line). The builder greps
  these in the file → real line numbers. Quote real text — if it's not in the
  file, the build fails loudly (which means you had the wrong file/snippet).
  - Escape hatch: `{ "lines": { "start": N, "end": M } }` if you genuinely have
    exact numbers, but the snippet form is preferred — it can't be wrong.
- `title` — short step title.
- `body` — a short summary (1-3 sentences) shown by default. Short ≠ dense: see
  **Writing the prose** below.
- `detail` — the in-depth part shown on "Show details": edge cases, rationale,
  gotchas, how it connects to other steps. Author it whenever there's depth.
- `highlight?` / `suggestions?` — optional.

### Writing the prose

Write every step for a reader who has **never seen this codebase** — assume they
don't know the symbols, the architecture, or the earlier PRs. Start each step from
a clean slate.

- **Translate, don't transcribe.** The first time a step names a code symbol (a
  function, type, phase, flag), gloss what it does in plain words right alongside
  it. Never let a bare identifier carry the meaning.
- **One idea per sentence.** Don't compress by stacking clauses, nesting
  parentheses, or chaining identifiers. If a sentence only parses for someone
  who already holds the whole model in their head, it has failed.
- **Lead with intent, then mechanism** — what the code now does and why it
  matters, before the how.
- The trap is writing from the diff's vocabulary: the symbols you just read are
  the cheapest words in your head. Resist it. Clarity outranks brevity here —
  spend the words.

Write it to a temp file, e.g. `/tmp/kvasir-draft.json`:

```json
{
  "title": "Auth: Auth0 OIDC across web + API",
  "source": "Claude research chat",
  "steps": [
    {
      "repoDir": "~/code/your-frontend",
      "file": "<the real path you read>",
      "locator": { "from": "export default handleAuth(", "to": "});" },
      "title": "Auth0 catch-all route",
      "body": "The SDK's login/logout/callback/me handler.",
      "detail": "offline_access enables silent refresh; the SDK persists the session in a secure cookie after Auth0 redirects back to the callback."
    },
    {
      "repoDir": "~/code/your-backend",
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
kvasir build /tmp/kvasir-draft.json
```

It resolves owner/name + head sha (`git`), verifies each file exists at that sha,
greps your locator snippets for the real line range, validates the shape, pushes
to the mailbox, and prints the **link**. (If `kvasir` isn't on PATH, run the
builder directly: `bun run <kvasir-repo>/packages/mimir/scripts/buildReview.ts /tmp/kvasir-draft.json`.)

## 3. Hand the user the link

Print the URL it output. The user opens it; the extension reads `?kvasir=<id>`, pulls
the walkthrough, and walks the steps — jumping across repos/files, GitHub
highlighting each line range, with body + "Show details" per step.

## If it fails (the builder tells you exactly which)

- **`file not found at <sha>: <path>`** → you had the wrong path/repo. Find the
  real file (`git -C <repoDir> ls-files | grep ...`) and fix `file`.
- **`locator.from not found`** → the snippet isn't in that file verbatim. Re-read
  the file and quote a real line.
- **`cannot reach the mailbox on :8799`** → the channel isn't running. Tell the
  user to start it with `kvasir`.
