// Heimdall — the watchman who raises Asgard. Pure boot glue: wires Midgard and
// the chat machine onto the Bifrost, creates the shadow-rooted host, injects the
// panel stylesheet, mounts the React app, and starts the watch (./watch.ts holds
// the tested logic).
import { createRoot } from "react-dom/client";
import { App } from "../asgard/App";
import asgardCss from "../asgard/asgard.compiled.css";
import { connectChat } from "../asgard/chat";
import { historyStore } from "../asgard/history";
import { launcherStore } from "../asgard/launcher";
import { pairingStore } from "../asgard/pairing";
import { reviewStore } from "../asgard/review";
import { hydratePanel } from "../asgard/store";
import { bifrost } from "../bifrost";
import { HISTORY_KEY, prUrl, reviewIdFromUrl } from "../keys";
import { connectMidgard } from "../midgard/connect";
import { connectGrip } from "../midgard/grip";
import { initTooltips } from "../midgard/tooltip";
import { onStored } from "../muninn";
import { shieldHotkeys } from "./shield";
import { applyTheme, loadPersisted, watchUrl } from "./watch";
// Compiled Tailwind + legacy panel CSS (build.mjs produces this from tailwind.css).

export function boot(): void {
  if (document.querySelector("#kvasir-root")) return; // re-injection guard
  // The content script matches PR pages AND any page that might carry a pushed
  // review (?kvasir). Bail on everything else so we don't mount on plain GitHub pages.
  const reviewId = reviewIdFromUrl();
  if (!prUrl() && !reviewId) {
    // A matched-but-not-yet-relevant page (e.g. a /blob/ page with no ?kvasir).
    // Don't mount, but poll for an SPA navigation INTO a PR/review — a soft nav
    // doesn't re-run the content script, so without this a blob→PR transition would
    // never raise the panel until a hard refresh. boot()'s #kvasir-root guard makes
    // the re-entry idempotent, and boot() starts watchUrl() to take over from there.
    const poll = setInterval(() => {
      if (prUrl() || reviewIdFromUrl()) {
        clearInterval(poll);
        boot();
      }
    }, 500);
    return;
  }

  // Midgard listens on the Bifrost before anything sends a command; Asgard's
  // chat machine listens for the grip's completed asks.
  connectMidgard(bifrost);
  connectGrip(bifrost);
  connectChat(bifrost);

  // Light-DOM fast tooltips (grip, ask bar) — bound once, after the guard.
  initTooltips();

  applyTheme();
  hydratePanel(); // sync: restore the panel's per-tab open/tab/geometry before mount
  // loadPersisted restores the per-PR tour state (step + overview "step 0"). The
  // walkthrough's start() reads it once the spec loads, so the spec load MUST wait for
  // it — otherwise start() races against default state, jumps to step 0, and goto(0)
  // overwrites the saved position on every reload.
  const persisted = loadPersisted();
  void pairingStore.refresh(); // resolve paired/unpaired up front so the panel can prompt
  // Review-mode (a pushed cross-repo review) pulls from the mailbox; a PR page runs
  // the walkthrough generator/poll as before.
  if (reviewId) {
    void persisted;
    void reviewStore.load(reviewId);
  } else void persisted.then(() => launcherStore.refresh());
  watchUrl();
  // Cross-tab: when another tab deletes a walkthrough it rewrites HISTORY_KEY; adopt
  // the new list here and drop this tab's open walkthrough if it was the deleted one.
  onStored(HISTORY_KEY, (value) => historyStore.observeExternal(value));

  // Review-mode: synchronously hydrate from the sessionStorage snapshot the prior
  // page wrote, so the panel's first paint is already complete (no async blink).
  if (reviewId) reviewStore.hydrate();

  const host = document.createElement("div");
  host.id = "kvasir-root";
  document.body.append(host);
  shieldHotkeys(host); // typing in Asgard must not trigger GitHub's hotkeys
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = asgardCss;
  shadow.append(style);
  const mount = document.createElement("div");
  shadow.append(mount);
  // The theme class lives on the host so :host / :host(.dark) tokens resolve.
  createRoot(mount).render(<App themeTarget={host} />);
}
