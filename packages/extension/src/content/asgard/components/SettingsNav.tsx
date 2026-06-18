// The Settings tab's contribution to the global left sidebar: anchor links that
// scroll the settings panel to each section. The sections (and their ids) are owned
// by SettingsTab; this jumps to them by querying from the panel's root (the shadow
// root in production), which getRootNode() resolves whether or not we're in a shadow
// DOM.
import type { JSX, MouseEvent as ReactMouseEvent } from "react";
import { SETTINGS_SECTIONS } from "./tabs/SettingsTab";

function jumpToSection(event: ReactMouseEvent, id: string): void {
  // getRootNode() resolves the shadow root in production (Asgard lives in one) or the
  // document in tests — both expose querySelector; anything else has no sections.
  const root = event.currentTarget.getRootNode();
  if (!(root instanceof Document || root instanceof ShadowRoot)) return;
  // eslint-disable-next-line unicorn/require-css-escape -- id is from the fixed SETTINGS_SECTIONS list, never user input
  const target = root.querySelector(`[data-settings-section="${id}"]`);
  if (target instanceof HTMLElement) target.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function SettingsNav(): JSX.Element {
  return (
    <ul className="py-2" data-testid="settings-nav">
      {SETTINGS_SECTIONS.map((section) => (
        <li key={section.id}>
          <button
            className="block w-full px-3 py-1.5 text-left text-sm text-foreground/90 hover:bg-muted hover:text-primary"
            onClick={(event) => jumpToSection(event, section.id)}
          >
            {section.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
