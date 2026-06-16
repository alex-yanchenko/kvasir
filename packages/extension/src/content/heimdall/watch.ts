// Heimdall's watch — the logic half of the watchman. Restores a PR's persisted
// state (chats, tour), pushes the theme across the Bifrost, and polls the URL:
// GitHub is a SPA, so PR navigation never re-runs the content script.
import { launcherStore } from "../asgard/launcher";
import { isChatSessionArray, parseTourState } from "../asgard/persisted";
import { state, touch } from "../asgard/store";
import { bifrost } from "../bifrost";
import { chatsKey, prUrl, tourKey } from "../keys";
import { storeGet } from "../muninn";

/** Per-PR state restore (survives refresh and browser restart). */
export async function loadPersisted(): Promise<void> {
  const pr = prUrl();
  if (pr) {
    const chats = await storeGet(chatsKey(pr));
    if (isChatSessionArray(chats) && chats.length > 0 && state.chatHistory.length === 0) {
      state.chatHistory = chats;
    }
    state.tourState = parseTourState(await storeGet(tourKey(pr)));
  }
  // Panel state (open/tab/geometry) is per-tab and hydrated synchronously at boot
  // (store.hydratePanel); loadPersisted only restores per-PR content.
  touch();
}

export function applyTheme(): void {
  bifrost.send("theme:apply", { theme: state.theme, hlStyle: state.hlStyle });
}

/** Poll for SPA navigation; on a PR switch, drop the old PR's state and load the
 * new one's. Returns a stop function; it also stops itself when the extension is
 * reloaded out from under the page (orphaned content script). */
export function watchUrl(intervalMs = 1500): () => void {
  let lastUrl = location.href;
  let currentPr = prUrl();
  const poll = setInterval(() => {
    if (!chrome.runtime?.id) {
      clearInterval(poll);
      return;
    }
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    const pr = prUrl();
    if (pr !== currentPr) {
      currentPr = pr;
      state.chatHistory = [];
      touch(); // React drops the panel content with the old PR's state
      state.tourState = { step: 0, pos: null, size: null };
      state.spec = null;
      launcherStore.resetForPr();
      void loadPersisted();
    }
    void launcherStore.refresh();
  }, intervalMs);
  return () => clearInterval(poll);
}
