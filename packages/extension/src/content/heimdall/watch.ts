// Heimdall's watch — the logic half of the watchman. Restores a PR's persisted
// state (chats, tour), pushes the theme across the Bifrost, and polls the URL:
// GitHub is a SPA, so PR navigation never re-runs the content script.
import { launcherStore } from "../asgard/launcher";
import { state, touch } from "../asgard/store";
import type { TourState } from "../asgard/store";
import type { ChatSession } from "../asgard/types";
import { bifrost } from "../bifrost";
import { chatsKey, panelKey, prUrl, tourKey } from "../keys";
import { storeGet } from "../muninn";

/** Per-PR state restore (survives refresh and browser restart). */
export async function loadPersisted(): Promise<void> {
  const pr = prUrl();
  if (!pr) return;
  const chats = await storeGet(chatsKey(pr));
  if (Array.isArray(chats) && chats.length && state.chatHistory.length === 0) {
    state.chatHistory = chats as ChatSession[]; // persisted data we wrote; shape is our own
    touch();
  }
  const t = await storeGet(tourKey(pr));
  if (typeof t === "object" && t !== null) {
    const stored = t as Partial<TourState>; // shape-checked field by field below
    state.tourState = {
      step: stored.step || 0,
      pos: stored.pos || null,
      size: stored.size || null,
    };
  }
  const p = await storeGet(panelKey(pr));
  if (typeof p === "object" && p !== null) {
    const stored = p as { pos?: typeof state.panel.pos; size?: typeof state.panel.size };
    state.panel.pos = stored.pos || null;
    state.panel.size = stored.size || null;
  }
}

export function applyTheme(): void {
  bifrost.send("theme:apply", { theme: state.theme, hlStyle: state.hlStyle });
}

/** Poll for SPA navigation; on a PR switch, drop the old PR's state and load the
 * new one's. Returns a stop function; it also stops itself when the extension is
 * reloaded out from under the page (orphaned content script). */
export function watchUrl(intervalMs = 1500): () => void {
  let lastUrl = location.href;
  let curPr = prUrl();
  const poll = setInterval(() => {
    if (!chrome.runtime?.id) {
      clearInterval(poll);
      return;
    }
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    const pr = prUrl();
    if (pr !== curPr) {
      curPr = pr;
      state.chatHistory = [];
      touch(); // React drops the panel content with the old PR's state
      state.tourState = { step: 0, pos: null, size: null };
      state.panel = { open: false, tab: state.panel.tab, pos: null, size: null };
      state.spec = null;
      launcherStore.resetForPr();
      void loadPersisted();
    }
    void launcherStore.refresh();
  }, intervalMs);
  return () => clearInterval(poll);
}
