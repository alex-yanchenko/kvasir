# Plan — deepen comprehension (flow, coverage, navigation)

Kvasir is a **comprehension** tool: understand a PR or a piece of code — its _flow_ and
surrounding context — not a review-output tool. Nothing here posts to GitHub or duplicates
review comments. (See the product-scope decision: comprehension axis only.)

Six shippable slices, each its own PR. Order is cheap→rich; all but one add **zero**
generation cost (render-side or deterministic), so they don't make walkthrough generation
slower — they make the panel deeper. (Only S5, the opt-in diagram, adds LLM time.)

## Principles & invariants (anchors for curveballs)

- **Coverage applies to PR walkthroughs only.** `WalkthroughSpec` (PR diff) has a manifest;
  `Review` (cross-repo source) has no diff. Coverage/outline-by-hunk are PR-only; outline +
  trail (derived from steps) work for both. When a feature needs the manifest, it's PR-only
  and degrades to absent for `Review`.
- **Don't add generation cost unless gated.** Only the diagram (S5) lengthens the LLM pass;
  it ships behind a default-off toggle. Everything else derives from data already produced
  (steps) or already computed server-side (coverage).
- **The spec is the contract.** New fields go on the zod schema in `runes` (schema-first;
  types are inferred), optional, so old cached specs still validate. Server stamps derived
  data; the model is never trusted for it.
- **Render-side state follows the `detailOpen` pattern** (module-level state in `tour.ts`)
  so it survives tab unmount/remount, per the persistence work already shipped.
- **Reuse existing navigation primitives:** `tourStore.goto(i)` to jump to a step;
  `bifrost.send("jump:ref", { file, start, end })` to jump to code/file (a `start:null`
  ref is a jump-to-file). Don't invent new jump plumbing.

## Architecture seams (where each slice plugs in)

- **Contract:** `packages/runes/src/spec.ts` (`WalkthroughSpec`/`WalkthroughStep`),
  `packages/runes/src/review.ts` (`Review`/`ReviewStep`).
- **Coverage compute:** `packages/mimir/src/manifest.ts` — `significantFiles`,
  `uncoveredFiles`, `COVERAGE_MIN_ADDS` (already exist, already tested).
- **Publish stamp:** `packages/mimir/src/publish.ts` `preparePublish` — already computes
  `uncovered` + stamps the spec. The place to attach derived `coverage`.
- **Serve to panel:** `packages/mimir/src/bridge.ts` `handleWalkthrough` (`GET /walkthrough`)
  → `specs.get(prKey)`. No change needed once the spec carries the data.
- **Render:** `packages/extension/src/content/asgard/` — tabs (`WalkthroughTab`/`ReviewTab`),
  `tour.ts` (step state + `goto`), `store.ts` (settings + getters), `bifrost.ts` (messages).
- **Live lookups (S4):** new bridge route + a channel-side `git grep`/ripgrep in the repo
  under the configured Local repos root (heavy infra reused).

---

## Slice 1 — Coverage signal (deterministic, zero gen cost) ✅ first

**Goal:** the panel shows, at a glance, that the walkthrough explains the _whole_ change —
"explains 7/9 changed files" + a list of significant files no step covered, each a jump.

- **Contract** (`spec.ts`): add optional
  `coverage?: { significant: string[]; uncovered: string[] }` to `WalkthroughSpecSchema`
  (PR-only; absent on `Review`). `covered` is derivable (`significant \ uncovered`).
- **Server** (`publish.ts` `preparePublish`): when a manifest exists, attach
  `coverage: { significant: significantFiles(manifest), uncovered }` to the `stamped` spec
  (`uncovered` already computed there). No new compute, no extra round-trip.
- **Render** (`WalkthroughTab`/`ReviewTab` header): a small badge "explains N/M changed
  files"; when `uncovered.length`, an expandable list, each path → `jump:ref { file,
start:null, end:null }`. Hidden entirely when `coverage` absent (Review / old specs).
- **Tests:** `publish.test.ts` — published outcome carries `coverage` with the right
  significant/uncovered arrays (full-object assert); absent-manifest path omits it.
  `manifest.ts` coverage helpers already covered. Render test: badge numbers + uncovered
  jump fires `jump:ref`.
- **AC:** badge reflects real counts; uncovered list jumps to the file; nothing shown for
  cross-repo reviews or pre-coverage cached specs.

## Slice 2 — Flow outline + altitude (render-side, zero gen cost)

**Goal:** a collapsible **Outline** of the whole flow — step titles grouped by repo→file —
so you grasp the shape, then drill in. Collapsed = skeleton; click = jump into the walk.

- **Contract:** none for v1 (derive grouping from consecutive same-`file`/same-`repo` step
  runs). _Optional follow-up:_ `section?: string` per step for logical-stage grouping
  ("validate"/"write") — a few tokens, defer unless wanted.
- **Render:** an Outline drawer/panel listing grouped step `title`s; click → `tourStore.goto(i)`.
  Outline open/closed is module-level state (`tour.ts`, `detailOpen` pattern) so it persists
  across tab switches. Works for both spec families (steps exist in both).
- **Tests:** outline renders the grouped titles in step order; clicking a node navigates;
  open-state survives a remount.
- **AC:** outline mirrors the steps, grouping by file/repo; jump works; collapsible + persistent.

## Slice 3 — Jump trail / breadcrumb (render-side, zero gen cost)

**Goal:** stay oriented when the flow crosses files/repos — a breadcrumb of the path the
walk has taken to the current step.

- **Render:** derive from the ordered steps up to the current index — the repo/file path
  ("repoA/x.ts → repoB/y.ts"), de-duplicating consecutive same-file. A crumb → `goto` that
  step. Module-level state if we track an actual visited stack; else pure-derived from
  `stepIndex`.
- **Tests:** breadcrumb reflects the path to the current step; crumb click navigates;
  consecutive same-file collapses to one crumb.
- **AC:** trail shows the file/repo path of the flow; crumbs jump.

## Slice 4 — On-demand go-to-def / callers (view-time query, zero gen cost)

**Goal:** from a step, ask "where is X defined / who calls X" without leaving the walk.

- **Bridge:** new route `POST /lookup` → `{ repo, symbol, kind: 'def'|'callers' }` →
  channel runs `git grep`/ripgrep in the repo under the Local repos root (heavy infra) →
  `{ hits: [{ file, line, snippet }] }`. View-time only; needs the channel live + repo
  present (degrade gracefully with a clear "repo not found locally" message).
- **Bifrost + render:** a new query message; a step affordance (select a symbol / a button)
  → results list → each hit `jump:ref { file, start:line, end:line }`.
- **Tests:** bridge handler returns hits given a mock grep dep (+ the not-found path);
  render shows results and a hit jumps.
- **AC:** "callers of X" lists real hits and jumps; clean message when repo isn't local.
- **Note:** heaviest slice (new route + subprocess + UI). Re-evaluate scope before starting.

## Slice 5 — Opt-in flow diagram (gen cost — gated)

**Goal:** an optional generated diagram (mermaid) of the flow as an overview.

- **Contract** (`spec.ts`): `diagram?: string` (mermaid source) on `WalkthroughSpec`.
- **Setting** (`store.ts`): `generateDiagram` (default **off**). Passed on `/generate`
  (like `depth`/`reposRoot`) so the channel instruction only authors a diagram when on.
- **Render:** add a `mermaid` dep; render the diagram in an overview view; jump from a node
  is a nice-to-have, not required.
- **Tests:** render when `diagram` present; toggle gates the generate payload; absent →
  no diagram UI. Test BOTH toggle states (flag discipline).
- **AC:** with the toggle on, the spec carries a diagram and the panel renders it; off →
  generation unchanged and no diagram UI.

## Slice 6 — Settings help text (render-side, zero gen cost)

**Goal:** every setting explains itself. Users won't infer what "Review depth", "Local
repos root", "Suggested questions", or "Highlight style" do — each control needs a short,
plain description of what it changes and when to pick which option.

- **Render** (`SettingsTab`): a one-line muted description under each control (or an info
  `(i)` affordance using the existing `data-kvasir-tip` tooltip — match whatever reads
  cleanest in the panel width). Cover every setting:
  - **Review depth** — Heavy reads the local repo for correctness (needs the repo cloned
    under the repos root); Light authors from the PR diff alone. Note the silent Heavy→Light
    fallback.
  - **Local repos root** — where Heavy looks for the clone (it searches under this path for
    a repo whose remote/name matches); shown only in Heavy.
  - **Suggested questions** — preload 3 AI question chips per chat (off by default; costs a
    model call when on).
  - **Theme / Highlight style** — what they restyle.
  - **(when S5 lands) Flow diagram** — opt-in; adds time to generation.
  - **Debug / Wipe** — already has a hint; keep it.
- **Tests:** each setting renders its description text; Heavy-only repos-root help shows only
  in Heavy.
- **AC:** no setting is unlabeled; descriptions match actual behavior (reconcile after any
  settings change — Hyrum: the text becomes the contract users rely on).

---

## Cost ledger

| Slice            | Generation cost                | Lives in                |
| ---------------- | ------------------------------ | ----------------------- |
| S1 coverage      | none (already computed)        | publish.ts + render     |
| S2 outline       | none                           | render                  |
| S3 trail         | none                           | render                  |
| S4 def/callers   | none (on click)                | bridge + channel query  |
| S5 diagram       | **yes — gated off by default** | settings + gen + render |
| S6 settings help | none                           | render                  |

Generation stays ~as-is for S1–S4 and S6; only S5 (opt-in) adds LLM time.

## Build order

S1 → S2 → S3 → S4 → S5 → S6 (settings help lands last so it can describe S5's diagram
toggle too — or pull it earlier if the current settings need explaining sooner). Reconcile
this doc at each slice boundary: name which slice the work served; if scope shifts, revise
here first, then build.
