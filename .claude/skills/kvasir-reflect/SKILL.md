---
name: kvasir-reflect
description: Reflect on a generated Kvasir walkthrough that came out wrong and fix the GENERATOR so it doesn't recur. Use when the user says a walkthrough "missed the point", "reads like the diff", "got the feature wrong", "is too shallow/dense", "explained the end state not the change", or otherwise points at a quality problem in a walkthrough Kvasir produced. Run inside a Kvasir session. This is about walkthrough QUALITY only — never extension features, refactors, or unrelated code.
---

# Reflect on a walkthrough and fix the generator

A walkthrough came out wrong. The goal here is NOT to hand-edit that one walkthrough —
it's to find the **root cause** and fix the thing that produced it (the channel
instructions / heavy pass / depth policy in `packages/mimir/src/channel.ts` and
`bridge.ts`), so the next walkthrough is better. Real misses are how the generator's
rules get written.

## What Kvasir is reviewing for (the bar to judge against)

A Kvasir walkthrough is an **explainer, not a code review**. Judge it on:

1. **Feature context is correct** — it explains what the feature IS and how the
   change fits the system, grounded in reality (the repo's `_wiki/`, the surrounding
   code), not just paraphrased from the diff.
2. **Flow + change is explained** — each step says what the code now does and why it
   matters (intent first), then the mechanism; the reader can follow how the pieces
   connect.
3. **Readable by a newcomer** — translates symbols into plain words, one idea per
   sentence, no diff-vocabulary soup.
4. **Proportional coverage** — every significant changed file earns steps; depth
   scales with the size of the change (no one-sentence-per-100-lines).

Finding a bug is a _bonus_, never the bar. Do NOT grade a walkthrough down for "not
catching bugs" — that's a different tool (pr-review).

## 1. Get the inputs

- The **PR** under discussion (url) → `gh pr diff` / `gh pr view` for ground truth of
  what actually changed.
- The **walkthrough** as generated — the specific step(s) that felt wrong. The user
  can copy step text from the panel, or you can pull the published spec from the local
  channel. You need the actual generated prose to diagnose it, not a paraphrase.
- The user's **specific complaint** — what felt wrong, in their words.

## 2. Diagnose the root cause

For each weak spot, name the failure mode (these map to existing generator rules):

| Symptom                                                   | Failure mode                  | Generator lever                              |
| --------------------------------------------------------- | ----------------------------- | -------------------------------------------- |
| Reads like the diff; bare identifiers carry meaning       | wrote from diff vocabulary    | PROSE RULE (`channel.ts`)                    |
| States _what_ changed but not _what the feature is_ / why | missing feature context       | HEAVY PASS — wiki/context read (`bridge.ts`) |
| Mechanism without the point                               | intent-after-mechanism        | PROSE RULE                                   |
| Incremental step re-explains from scratch                 | end-state, not delta          | step 6 before→after framing                  |
| One sentence for a big change; files skipped              | under-coverage                | step 3 + COVER list / coverage gate          |
| Took forever / traced everything                          | over-reading                  | DEPTH POLICY (one hop, not the call tree)    |
| Confidently wrong about how it works                      | read too little, or wrong hop | DEPTH POLICY / HEAVY PASS                    |

Be specific: quote the offending sentence, say which rule it violates, and _why_ the
generator produced it (e.g. "the patch's vocabulary was the cheapest words available").

## 3. Propose the durable fix

Write the concrete change to the **generator**, quoting the exact instruction text to
add or amend (in `channel.ts` instructions, the `heavyProtocol`/`baseInstruction` in
`bridge.ts`, or the depth/prose/coverage rules). The fix must:

- target the **rule**, not the one instance (the next fresh session must derive the
  right behavior from the doc — patch the principle, not the symptom);
- stay scoped to **walkthrough quality** — do not propose extension changes, new
  storage, or unrelated refactors;
- be **lean** — prefer tightening an existing instruction over adding a new step,
  check, or artifact.

## 4. Apply (only if asked)

On the user's go-ahead, make the instruction edit and run the mimir gates
(`pnpm -C ... lint` / `typecheck` / `vitest run`). The instructions are plain strings,
so a wording change is low-risk — but the bridge/channel tests assert key phrases, so
update those assertions when you change the phrase they pin.

## What this skill does NOT do

- Hand-fix a single walkthrough and stop (that leaves the generator unchanged).
- Add bug-finding/nit-hunting to the flow (Kvasir is an explainer).
- Touch the extension, storage, or anything outside the generation instructions.
