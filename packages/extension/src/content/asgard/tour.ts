// The walkthrough tour machine — Asgard-owned. The card is a React component;
// this holds the step state, the page commands (highlight + grip context), the
// per-PR persistence, and the "ask about this step" payload.
import type { WalkthroughStep } from "@kvasir/runes/spec";
import { bifrost } from "../bifrost";
import { onFilesTab, prUrl, tourKey } from "../keys";
import { stepCode } from "../midgard/diff";
import { storeSet } from "../muninn";
import { chatStore } from "./chat";
import { registerGuide } from "./guide";
import { awaitSoftNav, softNavigate } from "./lib/nav";
import { clampIndex, guideBackgroundText, stepContextText, whereText } from "./lib/stepText";
import { stripHtml } from "./lib/strip";
import { state, touch, tourDefaults } from "./store";

// This machine's state lives on state.tour (one home for app state — see store.ts):
// which step is showing, whether the overview "step 0" is the current view, and the
// detail/diagram panes' open flags — all machine-lifetime so they survive a tab
// switch (NOT React component state, which the tab unmount would drop). The sidebar's
// open state + width are panel geometry and live in state.panelPrefs, so this
// machine's close() can never collapse a sidebar opened on another tab.
export const tourStore = {
  kind: "walkthrough" as const,
  open: (): boolean => state.tour.open,
  stepIndex: (): number => state.tour.stepIndex,
  stepCount: (): number => state.spec?.steps.length ?? 0,
  step: (): WalkthroughStep | null =>
    state.tour.open && state.spec ? (state.spec.steps[state.tour.stepIndex] ?? null) : null,
  detailOpen: (): boolean => state.tour.detailOpen,
  setDetailOpen(value: boolean): void {
    state.tour.detailOpen = value;
    touch();
  },
  diagramOpen: (): boolean => state.tour.diagramOpen,
  setDiagramOpen(value: boolean): void {
    state.tour.diagramOpen = value;
    touch();
  },
  // The outline's "visited" dots live in state.persistedTour (persisted per PR, so a
  // reload keeps them). The stamp guard makes the reader authoritative: marks
  // earned on a different spec (a regenerate that hasn't hit goto() yet, or a
  // restored stale pair) never render as visited.
  isVisited: (stepId: string): boolean =>
    state.persistedTour.visitedStamp === state.spec?.generatedAt &&
    (state.persistedTour.visited ?? []).includes(stepId),

  /** Whether this spec carries an overview (and so has a "step 0"). */
  hasOverview: (): boolean => (state.spec ? !!state.spec.overview : false),
  /** Whether the overview "step 0" is the current view. */
  atOverview: (): boolean => state.tour.atOverview,
  /** Whether Back/Next can move from where we are now (drives the footer + arrows). */
  canBack: (): boolean => {
    if (!state.spec) return false;
    if (state.tour.atOverview) return false;
    return state.tour.stepIndex > 0 || !!state.spec.overview;
  },
  canNext: (): boolean => {
    if (!state.spec) return false;
    if (state.tour.atOverview) return true;
    return state.tour.stepIndex < state.spec.steps.length - 1;
  },

  /** Show the overview "step 0": prose only, no code target, so clear the page. */
  gotoOverview(): void {
    if (!state.spec || !state.spec.overview) return;
    state.tour.atOverview = true;
    state.tour.diagramOpen = false;
    state.activeStep = null;
    state.persistedTour = { ...state.persistedTour, overview: true }; // restore here on reopen
    storeSet(tourKey(prUrl()), state.persistedTour);
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
    state.tour.open = true;
    // Restore the overview "step 0" if that's where we left off; otherwise resume the
    // last code step. The persisted flag can outlive its spec (regenerated without an
    // overview), so guard on the current spec too.
    if (state.persistedTour.overview && state.spec.overview) {
      tourStore.gotoOverview();
      return;
    }
    tourStore.goto(state.persistedTour.step || 0);
  },

  goto(index: number): void {
    if (!state.spec) return;
    state.tour.atOverview = false; // navigating to a real step always leaves the overview
    const stepIndex = clampIndex(index, state.spec.steps.length);
    state.tour.stepIndex = stepIndex;
    const s = state.spec.steps[stepIndex];
    // Visited dots: a regenerated spec (new generatedAt) starts fresh; landing on a
    // step marks it. Remember where we are (and that we're off the overview).
    const stamp = state.spec.generatedAt;
    const prior = stamp === state.persistedTour.visitedStamp ? (state.persistedTour.visited ?? []) : [];
    const visited = s && !prior.includes(s.id) ? [...prior, s.id] : prior;
    state.persistedTour = { ...state.persistedTour, step: stepIndex, overview: false, visited, visitedStamp: stamp };
    storeSet(tourKey(prUrl()), state.persistedTour);
    if (!s) return; // empty spec / out-of-range — nothing to highlight
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
    if (state.tour.atOverview) tourStore.gotoOverview();
    else tourStore.goto(state.tour.stepIndex);
  },

  /** Advance to the next step; a no-op on the last (the Next control is disabled).
   * From the overview "step 0" it advances to the first code step. */
  next(): void {
    if (state.tour.atOverview) {
      tourStore.goto(0);
      return;
    }
    if (state.spec && state.tour.stepIndex < state.spec.steps.length - 1) {
      tourStore.goto(state.tour.stepIndex + 1);
    }
  },
  /** Step back; from the first code step it falls into the overview "step 0" (if any). */
  back(): void {
    if (state.tour.atOverview) return;
    if (state.tour.stepIndex > 0) {
      tourStore.goto(state.tour.stepIndex - 1);
      return;
    }
    if (tourStore.hasOverview()) tourStore.gotoOverview();
  },

  /** PR navigation: the tour belonged to the previous PR — snap the whole machine
   * back to defaults. No page commands (unlike close()): the navigation already
   * replaced the old diff, so there is nothing to un-highlight. Without this, a
   * stale tour.open would auto-reapply the NEW PR's walkthrough at a stale step
   * the moment the launcher refresh lands. */
  resetForPr(): void {
    state.tour = tourDefaults();
    touch();
  },

  close(): void {
    state.tour.open = false;
    state.tour.atOverview = false;
    // The diagram overlay is walkthrough-scoped: closing/regenerating must not leave
    // it open, or a regenerated spec that carries a diagram would auto-open it unasked.
    state.tour.diagramOpen = false;
    bifrost.send("highlight:clear", undefined);
    state.activeStep = null;
    bifrost.send("grip:context", { hasActiveStep: false });
    touch();
  },

  /** Distilled plain-text view of the whole walkthrough (overview + steps), sent
   * to /ask so even a fresh session understands the PR. */
  backgroundContext(): string {
    if (!state.spec) return "";
    const head = state.spec.overview ? `Overview: ${stripHtml(state.spec.overview)}\n\n` : "";
    return guideBackgroundText(
      head,
      state.spec.steps.map((st) => ({
        title: st.title,
        where: whereText(st.file, st.lines),
        body: st.body,
      })),
    );
  },

  /** Compact text of the current step — passed to chat so answers are framed by it. */
  stepContext(): string {
    if (!state.activeStep) return "";
    const s = state.activeStep;
    return stepContextText({
      title: s.title,
      where: whereText(s.file, s.lines),
      body: s.body,
      detail: s.detail,
    });
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

// Self-registration keeps guide.ts import-free of the stores (see its registry
// comment): chat calls into activeGuide() while this store calls into chatStore,
// and a direct import in guide.ts would close that ESM cycle.
registerGuide(tourStore);
