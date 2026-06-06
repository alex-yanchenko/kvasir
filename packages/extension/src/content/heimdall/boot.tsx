// Heimdall — the watchman who raises Asgard. Pure boot glue: wires Midgard and
// the chat machine onto the Bifrost, creates the shadow-rooted host, injects the
// panel stylesheet, mounts the React app, and starts the watch (./watch.ts holds
// the tested logic).
import { createRoot } from "react-dom/client";
import { App } from "../asgard/App";
import { connectChat } from "../asgard/chat";
import { launcherStore } from "../asgard/launcher";
import { bifrost } from "../bifrost";
import { connectMidgard } from "../midgard/connect";
import { connectGrip } from "../midgard/grip";
import { initTooltips } from "../midgard/tooltip";
import { applyTheme, loadPersisted, watchUrl } from "./watch";
import asgardCss from "../asgard/asgard.css";

export function boot(): void {
  if (document.getElementById("prw-root")) return; // re-injection guard

  // Midgard listens on the Bifrost before anything sends a command; Asgard's
  // chat machine listens for the grip's completed asks.
  connectMidgard(bifrost);
  connectGrip(bifrost);
  connectChat(bifrost);

  // Light-DOM fast tooltips (grip, ask bar) — bound once, after the guard.
  initTooltips();

  applyTheme();
  void loadPersisted();
  void launcherStore.refresh();
  watchUrl();

  const host = document.createElement("div");
  host.id = "prw-root";
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = asgardCss;
  shadow.appendChild(style);
  const mount = document.createElement("div");
  shadow.appendChild(mount);
  createRoot(mount).render(<App />);
}
