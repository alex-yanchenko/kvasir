// Heimdall's watch — the logic half of the watchman. Restores a PR's persisted
// state (chats, tour), pushes the theme across the Bifrost, and watches the URL
// (Navigation API events when available, else polling): GitHub is a SPA, so PR
// navigation never re-runs the content script.
import { launcherStore } from "../asgard/launcher";
import { isChatSessionArray, parseTourState } from "../asgard/persisted";
import { state, touch } from "../asgard/store";
import { bifrost } from "../bifrost";
import { chatScope, chatsKey, prUrl, reviewIdFromUrl, tourKey } from "../keys";
import { storeGet } from "../muninn";

/** Per-guide state restore (survives refresh and browser restart). Chats key off
 * the guide's chat scope — the PR url, or a pushed review's id on blob pages —
 * while the tour is a PR-only concept. */
export async function loadPersisted(): Promise<void> {
  const scope = chatScope();
  if (scope) {
    const chats = await storeGet(chatsKey(scope));
    if (isChatSessionArray(chats) && chats.length > 0 && state.chatHistory.length === 0) {
      state.chatHistory = chats;
    }
  }
  const pr = prUrl();
  if (pr) {
    state.tourState = parseTourState(await storeGet(tourKey(pr)));
  }
  // Panel state (open/tab/geometry) is per-tab and hydrated synchronously at boot
  // (store.hydratePanel); loadPersisted only restores per-PR content.
  touch();
}

export function applyTheme(): void {
  bifrost.send("theme:apply", { theme: state.theme, hlStyle: state.hlStyle });
}

/** The Navigation API's event target (Chrome 102+) — an event the moment the SPA
 * router lands, instead of waiting out a poll tick. Optional: jsdom and browsers
 * without it return null and callers fall back to polling. */
const navigationTarget = (): EventTarget | null => {
  if (!("navigation" in globalThis)) return null;
  const nav: unknown = Reflect.get(globalThis, "navigation");
  return nav instanceof EventTarget ? nav : null;
};

/** Watch for SPA navigation; on a PR switch, drop the old PR's state and load the
 * new one's. Reacts instantly via the Navigation API when present; the poll stays
 * as the fallback. Returns a stop function; it also stops itself when the
 * extension is reloaded out from under the page (orphaned content script). */
export function watchUrl(intervalMs = 1500): () => void {
  let lastUrl = location.href;
  let currentPr = prUrl();
  const onChange = (): void => {
    if (!chrome.runtime?.id) {
      stop();
      return;
    }
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    const pr = prUrl();
    if (pr === currentPr) {
      void launcherStore.refresh(); // same PR, just an SPA tab change (Conversation ↔ Files)
    } else {
      currentPr = pr;
      state.chatHistory = [];
      touch(); // React drops the panel content with the old PR's state
      state.tourState = { step: 0, overview: false, pos: null, size: null };
      state.spec = null;
      launcherStore.resetForPr();
      // The spec load triggers the tour's start(), so it must wait for the new PR's
      // tour state to land — same ordering the boot path relies on (see boot.tsx).
      void loadPersisted().then(() => launcherStore.refresh());
    }
  };
  const nav = navigationTarget();
  nav?.addEventListener("navigatesuccess", onChange);
  const poll = setInterval(onChange, intervalMs);
  function stop(): void {
    clearInterval(poll);
    nav?.removeEventListener("navigatesuccess", onChange);
  }
  return stop;
}

/** A matched-but-not-yet-relevant page (e.g. a /blob/ page with no ?kvasir): wait
 * for an SPA navigation INTO a PR/review, fire onEnter once, and disarm. The
 * Navigation API path fires instantly; the fallback poll starts at baseMs and
 * doubles up to a 10s ceiling, so an abandoned background tab isn't polled at
 * 500ms forever. */
export function waitForRelevantPage(onEnter: () => void, baseMs = 500): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const nav = navigationTarget();
  const check = (): void => {
    if (!prUrl() && !reviewIdFromUrl()) return;
    stop();
    onEnter();
  };
  nav?.addEventListener("navigatesuccess", check);
  const schedule = (delayMs: number): void => {
    timer = setTimeout(() => {
      check();
      if (timer) schedule(Math.min(delayMs * 2, 10_000)); // stop() nulled it if we fired
    }, delayMs);
  };
  schedule(baseMs);
  function stop(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    nav?.removeEventListener("navigatesuccess", check);
  }
  return stop;
}
