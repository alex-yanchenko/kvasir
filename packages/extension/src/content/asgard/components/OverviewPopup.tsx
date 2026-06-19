// The PR overview as a dropdown anchored under the toolbar — the "what is this change
// about" context, opened on demand. NOT a full-screen modal: a transparent click-away
// dismisses it without darkening or blocking the page. Renders the overview's HTML
// (sanitized, same as a step body). Rendered inside the (relative) toolbar row so it
// anchors there.
import { X } from "lucide-react";
import { useEffect } from "react";
import type { JSX } from "react";
import { sanitizeSpecHtml } from "../../sanitize";

export function OverviewPopup({
  overview,
  onClose,
}: Readonly<{ overview: string; onClose: () => void }>): JSX.Element {
  // Escape closes — the keyboard equivalent of clicking away.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- transparent click-away to dismiss (no backdrop dim); keyboard users close via the Close button or Escape (handler above). */}
      <div className="fixed inset-0 z-[2147483009]" onClick={onClose} />
      <div
        role="dialog"
        aria-label="Overview"
        className="absolute left-2 right-2 top-full z-[2147483010] mt-1 max-h-[60vh] overflow-y-auto rounded-lg border border-border bg-background p-3 shadow-xl"
      >
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Overview
          </span>
          <button
            type="button"
            aria-label="Close overview"
            className="text-muted-foreground hover:text-foreground"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div
          className="kvasir-prose text-sm"
          dangerouslySetInnerHTML={{ __html: sanitizeSpecHtml(overview) }}
        />
      </div>
    </>
  );
}
