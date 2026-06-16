// Heimdall — the watchman who raises Asgard. Pure boot glue: wires Midgard and
// the chat machine onto the Bifrost, creates the shadow-rooted host, injects the
// panel stylesheet, mounts the React app, and starts the watch (./watch.ts holds
// the tested logic).
import { createRoot } from "react-dom/client";
import { App } from "../asgard/App";
import asgardCss from "../asgard/asgard.compiled.css";
import { connectChat } from "../asgard/chat";
import { launcherStore } from "../asgard/launcher";
import { pairingStore } from "../asgard/pairing";
import { reviewStore } from "../asgard/review";
import { hydratePanel } from "../asgard/store";
import { bifrost } from "../bifrost";
import { prUrl, reviewIdFromUrl } from "../keys";
import { connectMidgard } from "../midgard/connect";
import { connectGrip } from "../midgard/grip";
import { initTooltips } from "../midgard/tooltip";
import { shieldHotkeys } from "./shield";
import { applyTheme, loadPersisted, watchUrl } from "./watch";
// Compiled Tailwind + legacy panel CSS (build.mjs produces this from tailwind.css).

export function boot(): void {
  if (document.querySelector("#prw-root")) return; // re-injection guard
  // The content script matches PR pages AND any page that might carry a pushed
  // review (?prw). Bail on everything else so we don't mount on plain GitHub pages.
  const reviewId = reviewIdFromUrl();
  if (!prUrl() && !reviewId) return;

  // Midgard listens on the Bifrost before anything sends a command; Asgard's
  // chat machine listens for the grip's completed asks.
  connectMidgard(bifrost);
  connectGrip(bifrost);
  connectChat(bifrost);

  // Light-DOM fast tooltips (grip, ask bar) — bound once, after the guard.
  initTooltips();

  applyTheme();
  hydratePanel(); // sync: restore the panel's per-tab open/tab/geometry before mount
  void loadPersisted();
  void pairingStore.refresh(); // resolve paired/unpaired up front so the panel can prompt
  // Review-mode (a pushed cross-repo review) pulls from the mailbox; a PR page runs
  // the walkthrough generator/poll as before.
  if (reviewId) void reviewStore.load(reviewId);
  else void launcherStore.refresh();
  watchUrl();

  // Review-mode: synchronously hydrate from the sessionStorage snapshot the prior
  // page wrote, so the panel's first paint is already complete (no async blink).
  if (reviewId) reviewStore.hydrate();

  const host = document.createElement("div");
  host.id = "prw-root";
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
