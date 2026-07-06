// Keydown listening that works under the hotkey shield: events born inside the
// shadow root are stopped at the host (heimdall/shield.ts), so a document
// listener alone never hears them — bind BOTH the document and the shadow root.
// Editable targets are skipped (typing must never trigger shortcuts). The
// handler goes through a ref so callers can pass a fresh closure every render
// without re-binding the listeners.
import { useEffect, useRef } from "react";

export function useShadowAwareKeydown(handler: (event: KeyboardEvent) => void): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const onKey = (event: Event): void => {
      if (!(event instanceof KeyboardEvent)) return;
      const t = event.target;
      if (t instanceof HTMLElement && (/^(?:TEXTAREA|INPUT|SELECT)$/.test(t.tagName) || t.isContentEditable))
        return;
      latest.current(event);
    };
    const root = document.querySelector("#kvasir-root")?.shadowRoot ?? document;
    document.addEventListener("keydown", onKey);
    if (root !== document) root.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (root !== document) root.removeEventListener("keydown", onKey);
    };
  }, []);
}
