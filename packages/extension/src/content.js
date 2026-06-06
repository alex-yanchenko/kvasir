// PR Walkthrough — content-script shell. Heimdall (via content/index.tsx) raises
// Asgard; this remaining vanilla sliver wires Midgard onto the Bifrost, restores
// per-PR state, and watches the URL. It collapses into heimdall at E1.
import { connectMidgard } from "./content/midgard/connect";
import { connectGrip } from "./content/midgard/grip";
import { bifrost } from "./content/bifrost";
import { state } from "./content/state";
import { initTooltips } from "./content/ui/tooltip";
import { storeGet } from "./content/muninn";
import { chatsKey, prUrl, tourKey } from "./content/keys";
import { touch } from "./content/asgard/store";
import { launcherStore } from "./content/asgard/launcher";

(() => {
  if (window.__prwLoaded) return;
  window.__prwLoaded = true;

  // Midgard listens on the Bifrost before anything sends a command.
  connectMidgard(bifrost);
  connectGrip(bifrost);

  // Fast tooltips for light-DOM [data-prw-tip] elements (grip, ask bar). Init
  // after the re-injection guard so the document listeners bind exactly once.
  initTooltips();

  // ── per-PR state restore (survives refresh and browser restart) ──────────────
  async function loadPersisted() {
    const pr = prUrl();
    if (!pr) return;
    const chats = await storeGet(chatsKey(pr));
    if (Array.isArray(chats) && chats.length && state.chatHistory.length === 0) {
      state.chatHistory = chats;
      touch();
    }
    const t = await storeGet(tourKey(pr));
    if (t) state.tourState = { step: t.step || 0, pos: t.pos || null, size: t.size || null };
  }

  const applyTheme = () => bifrost.send("theme:apply", { theme: state.theme, hlStyle: state.hlStyle });

  applyTheme();
  loadPersisted();
  void launcherStore.refresh();

  // ── URL watcher: GitHub is a SPA — detect PR navigation and reload state ─────
  let lastUrl = location.href;
  let curPr = prUrl();
  const poll = setInterval(() => {
    if (!chrome.runtime?.id) {
      clearInterval(poll);
      return;
    } // orphaned after a reload
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      const pr = prUrl();
      if (pr !== curPr) {
        // switched to a different PR — load that PR's stored state
        curPr = pr;
        state.chatHistory = [];
        touch(); // React drops the chats button and any open chat with it
        state.tourState = { step: 0, pos: null, size: null };
        state.spec = null;
        launcherStore.resetForPr();
        loadPersisted();
      }
      void launcherStore.refresh();
    }
  }, 1500);
})();
