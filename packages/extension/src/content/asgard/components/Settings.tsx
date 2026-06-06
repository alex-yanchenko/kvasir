// The settings gear + popover — Asgard's first island. Choices live in the store;
// the page only ever hears about them through the theme:apply command.
import type { JSX } from "react";
import { useState, useSyncExternalStore } from "react";
import { getSnapshot, settingsStore, subscribe } from "../store";

export function Settings(): JSX.Element {
  const [open, setOpen] = useState(false);
  useSyncExternalStore(subscribe, getSnapshot);
  return (
    <>
      <button
        className="prw-gear"
        title="PR Walkthrough settings"
        aria-label="Settings"
        onClick={() => setOpen((o) => !o)}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx={12} cy={12} r={3} />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      {open && (
        <div className="prw-settings-pop">
          <label>
            theme
            <select
              aria-label="theme"
              value={settingsStore.theme()}
              onChange={(e) => settingsStore.setTheme(e.target.value)}
            >
              <option value="auto">auto</option>
              <option value="light">light</option>
              <option value="dark">dark</option>
            </select>
          </label>
          <label>
            highlight
            <select
              aria-label="highlight"
              value={settingsStore.hlStyle()}
              onChange={(e) => settingsStore.setHlStyle(e.target.value)}
            >
              <option value="tint">tint</option>
              <option value="github">github-style</option>
            </select>
          </label>
        </div>
      )}
    </>
  );
}
