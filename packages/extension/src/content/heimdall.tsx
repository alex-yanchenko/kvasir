// Heimdall — the watchman who raises Asgard. Creates the shadow-rooted host,
// injects the panel stylesheet, and mounts the React app. The URL/PR watcher and
// generation poll migrate here from the legacy world once the store lands.
import { createRoot } from "react-dom/client";
import { App } from "./asgard/App";
import asgardCss from "./asgard/asgard.css";

export function boot(): void {
  if (document.getElementById("prw-root")) return; // re-injection guard
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
