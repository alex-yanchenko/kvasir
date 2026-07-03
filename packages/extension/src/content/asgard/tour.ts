// The walkthrough tour machine — Asgard-owned. The card is a React component;
// this holds the step state, the page commands (highlight + grip context), the
// per-PR persistence, and the "ask about this step" payload.
import type { WalkthroughStep } from "@kvasir/runes/spec";
import { bifrost } from "../bifrost";
import { onFilesTab, prUrl, tourKey } from "../keys";
import { stepCode } from "../midgard/diff";
import { storeSet } from "../muninn";
import { chatStore } from "./chat";
import { awaitSoftNav, softNavigate } from "./lib/nav";
import { stripHtml } from "./lib/strip";
import { state, touch } from "./store";
// chat.ts imports tourStore.stepContext and we call chatStore here — a runtime-
// safe ESM cycle: both references happen inside functions, never at module eval.

let open = false;
let stepIndex = 0;
// The overview "step 0" view: a prose-only intro before the first code step. Lives
// here (not in the steps array) so it stays out of coverage/outline-by-file and keeps
// its own place in the Back/Next sequence. Module-level so it survives a tab switch.
let atOverview = false;
// The detail pane's open state lives here, NOT in React component state, so it
// survives the WalkthroughTab unmount when you switch to Chat/Settings and back.
let detailOpen = false;
// The flow-diagram overlay's open state — module-level for the same reason as
// detailOpen (survives a tab switch). The sidebar's open state + width are panel
// geometry and live in panelStore (so this machine's close() can't collapse them).
let diagramOpen = false;
// Steps the user has actually opened this walkthrough (by id) — drives the outline's
// "visited" dots. Reset when the spec is regenerated (generatedAt changes), tracked
// here rather than recomputed from stepIndex so a visited mark persists after you
// navigate back.
let visited = new Set<string>();
let visitedStamp = "";

const clamp = (index: number, length: number): number => Math.min(Math.max(index, 0), length - 1);

export const tourStore = {
  kind: "walkthrough" as const,
  open: (): boolean => open,
  stepIndex: (): number => stepIndex,
  stepCount: (): number => state.spec?.steps.length ?? 0,
  step: (): WalkthroughStep | null => (open && state.spec ? (state.spec.steps[stepIndex] ?? null) : null),
  detailOpen: (): boolean => detailOpen,
  setDetailOpen(value: boolean): void {
    detailOpen = value;
    touch();
  },
  diagramOpen: (): boolean => diagramOpen,
  setDiagramOpen(value: boolean): void {
    diagramOpen = value;
    touch();
  },
  isVisited: (stepId: string): boolean => visited.has(stepId),

  /** Whether this spec carries an overview (and so has a "step 0"). */
  hasOverview: (): boolean => (state.spec ? !!state.spec.overview : false),
  /** Whether the overview "step 0" is the current view. */
  atOverview: (): boolean => atOverview,
  /** Whether Back/Next can move from where we are now (drives the footer + arrows). */
  canBack: (): boolean => {
    if (!state.spec) return false;
    if (atOverview) return false;
    return stepIndex > 0 || !!state.spec.overview;
  },
  canNext: (): boolean => {
    if (!state.spec) return false;
    if (atOverview) return true;
    return stepIndex < state.spec.steps.length - 1;
  },

  /** Show the overview "step 0": prose only, no code target, so clear the page. */
  gotoOverview(): void {
    if (!state.spec || !state.spec.overview) return;
    atOverview = true;
    diagramOpen = false;
    state.activeStep = null;
    state.tourState = { ...state.tourState, overview: true }; // restore here on reopen
    storeSet(tourKey(prUrl()), state.tourState);
    bifrost.send("highlight:clear", undefined);
    bifrost.send("grip:context", { hasActiveStep: false });
    touch();
  },

  start(): void {
    if (!state.spec) return;
    // Open and resume where you left off. Off the diff (e.g. the PR conversation
    // tab) the highlight commands simply find no rows and no-op — the panel still
    // shows the step text, and highlighting re-engages when you're on the Files
    // tab. Deliberately does NOT navigate: a passive restore on refresh must never
    // yank the page to /files.
    open = true;
    // Restore the overview "step 0" if that's where we left off; otherwise resume the
    // last code step. The persisted flag can outlive its spec (regenerated without an
    // overview), so guard on the current spec too.
    if (state.tourState.overview && state.spec.overview) {
      tourStore.gotoOverview();
      return;
    }
    tourStore.goto(state.tourState.step || 0);
  },

  goto(index: number): void {
    if (!state.spec) return;
    atOverview = false; // navigating to a real step always leaves the overview
    stepIndex = clamp(index, state.spec.steps.length);
    // remember where we are (and that we're off the overview)
    state.tourState = { ...state.tourState, step: stepIndex, overview: false };
    storeSet(tourKey(prUrl()), state.tourState);
    const s = state.spec.steps[stepIndex];
    if (!s) return; // empty spec / out-of-range — nothing to highlight
    // Reset the visited set when the walkthrough is regenerated, then mark this step.
    if (state.spec.generatedAt !== visitedStamp) {
      visited = new Set<string>();
      visitedStamp = state.spec.generatedAt;
    }
    visited.add(s.id);
    state.activeStep = s; // current step → available as chat context
    bifrost.send("grip:context", { hasActiveStep: true });
    bifrost.send("highlight:step", {
      anchor: s.anchor,
      lines: s.lines ?? null,
      highlight: s.highlight ?? null,
    });
    touch();
  },

  /** A user jump to a step's code (the outline + the scroll-to-code button). Selects the
   * step, then — when we're off the diff (e.g. the PR Conversation tab) — soft-navigates
   * to the Files tab and re-highlights once it lands, so the code is actually shown.
   * goto() alone only issues highlight commands, which no-op off the diff. Unlike start()
   * (a passive restore that must never yank the page), this is an explicit user action. */
  jumpToStep(index: number): void {
    tourStore.goto(index);
    const pr = prUrl();
    if (!pr || onFilesTab()) return;
    const filesUrl = `${pr}/files`;
    softNavigate(filesUrl);
    // reapply once GitHub's router lands on /files; the diff is rendered by then so the
    // highlight sticks. watchUrl's refresh() is a slower backstop if this races.
    awaitSoftNav(new URL(filesUrl).pathname, () => tourStore.reapply());
  },

  /** Re-issue the page commands for wherever we currently are (overview or a step),
   * without changing position. Used after an SPA refresh lands back on the diff —
   * a raw goto(stepIndex) here would silently drop the overview. */
  reapply(): void {
    if (!state.spec) return;
    if (atOverview) tourStore.gotoOverview();
    else tourStore.goto(stepIndex);
  },

  /** Advance to the next step; a no-op on the last (the Next control is disabled).
   * From the overview "step 0" it advances to the first code step. */
  next(): void {
    if (atOverview) {
      tourStore.goto(0);
      return;
    }
    if (state.spec && stepIndex < state.spec.steps.length - 1) tourStore.goto(stepIndex + 1);
  },
  /** Step back; from the first code step it falls into the overview "step 0" (if any). */
  back(): void {
    if (atOverview) return;
    if (stepIndex > 0) {
      tourStore.goto(stepIndex - 1);
      return;
    }
    if (tourStore.hasOverview()) tourStore.gotoOverview();
  },

  close(): void {
    open = false;
    atOverview = false;
    // The diagram overlay is walkthrough-scoped: closing/regenerating must not leave
    // it open, or a regenerated spec that carries a diagram would auto-open it unasked.
    diagramOpen = false;
    bifrost.send("highlight:clear", undefined);
    state.activeStep = null;
    bifrost.send("grip:context", { hasActiveStep: false });
    touch();
  },

  /** Distilled plain-text view of the whole walkthrough (overview + steps), sent
   * to /ask so even a fresh session understands the PR. */
  backgroundContext(): string {
    if (!state.spec) return "";
    const head = state.spec.overview
      ? `Overview: ${state.spec.overview
          .replaceAll(/<[^>]+>/g, "")
          .replaceAll(/\s+/g, " ")
          .trim()}\n\n`
      : "";
    const steps = state.spec.steps
      .map((st) => {
        const lineSuffix = st.lines ? `:${st.lines.start}-${st.lines.end}` : "";
        const where = st.file ? ` (${st.file}${lineSuffix})` : "";
        const body = st.body
          .replaceAll(/<[^>]+>/g, "")
          .replaceAll(/\s+/g, " ")
          .trim();
        return `• ${st.title}${where}\n  ${body}`;
      })
      .join("\n");
    return (head + steps).slice(0, 12_000);
  },

  /** Compact text of the current step — passed to chat so answers are framed by it. */
  stepContext(): string {
    if (!state.activeStep) return "";
    const s = state.activeStep;
    const lineSuffix = s.lines ? `:${s.lines.start}-${s.lines.end}` : "";
    const where = s.file ? ` (${s.file}${lineSuffix})` : "";
    return `Step: ${s.title}${where}\n${stripHtml(s.body)}${s.detail ? "\n" + stripHtml(s.detail) : ""}`;
  },

  /** "Ask about this step": build a selection payload for the step's own code
   * (live rows when rendered; highlight/body text otherwise) and open a chat
   * framed by the step's context. */
  askAboutStep(): void {
    const s = state.activeStep;
    if (!s) return;
    const page = stepCode({ anchor: s.anchor, lines: s.lines ?? null });
    const text =
      page?.text ||
      (s.highlight ?? []).join("\n") ||
      (s.body || "").replaceAll(/<[^>]+>/g, "").slice(0, 1000);
    const rect = page?.rect ?? { left: 60, top: 90, bottom: 114, height: 24 };
    chatStore.openSelection(
      {
        // Key the chat by the step id (stable) so re-asking reopens the same chat
        // and WalkthroughTab can tell a step already has one.
        selectionId: `step:${s.id}`,
        stepId: s.id,
        file: s.file,
        text,
        lines: s.lines ?? null,
        rect,
      },
      true,
    );
  },
};
