// Heimdall's watch — the logic half of the watchman. Restores a PR's persisted
// state (chats, tour), pushes the theme across the Bifrost, and polls the URL:
// GitHub is a SPA, so PR navigation never re-runs the content script.
import { launcherStore } from "../asgard/launcher";
import {
  isChatSessionArray,
  parsePanelGeometry,
  parsePanelPersisted,
  parseTourState,
} from "../asgard/persisted";
import { isPanelTab, PANEL_TABS, state, touch } from "../asgard/store";
import { bifrost } from "../bifrost";
import { chatsKey, historyNavActive, PANEL_GEOM_KEY, prUrl, tourKey } from "../keys";
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
  // Panel geometry is global — restored on every page, including review/blob pages
  // with no PR url (which otherwise snap the panel to default on each nav).
  const storedPanel = await storeGet(PANEL_GEOM_KEY);
  const { pos, size } = parsePanelGeometry(storedPanel);
  state.panel.pos = pos;
  state.panel.size = size;
  // Restore open + tab so the panel survives navigation as a persistent window
  // (the user asked to keep it open while moving between pages).
  const { open, tab } = parsePanelPersisted(storedPanel);
  state.panel.open = open;
  if (tab && isPanelTab(tab)) state.panel.tab = tab;
  // Landed via a History jump: force the panel open on History so the next review is
  // one click away (review.ts then won't switch it to the Walkthrough tab).
  if (historyNavActive()) {
    state.panel.open = true;
    state.panel.tab = PANEL_TABS.HISTORY;
  }
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
      state.panel = { open: state.panel.open, tab: state.panel.tab, pos: null, size: null };
      state.spec = null;
      launcherStore.resetForPr();
      void loadPersisted();
    }
    void launcherStore.refresh();
  }, intervalMs);
  return () => clearInterval(poll);
}
