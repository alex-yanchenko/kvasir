// The PR overview as a dismissible modal — the "what is this change about" context,
// opened on demand from the toolbar so it orients the reader without sitting in the
// step column. Shadcn-styled overlay inside the shadow root (no Radix portal);
// closes on backdrop click or Escape. overview is plain text — rendered as text
// (JSX-escaped), never HTML.
import { useEffect } from "react";
import type { JSX } from "react";
import { Button } from "../ui/button";

export function OverviewPopup({
  overview,
  onClose,
}: Readonly<{ overview: string; onClose: () => void }>): JSX.Element {
  // Escape closes the modal — the keyboard equivalent of the backdrop click.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- backdrop click-to-dismiss is a mouse convenience; keyboard users close via the Close button or Escape (handler above).
    <div
      className="kvasir-dialog-back fixed inset-0 z-[2147483010] flex items-center justify-center bg-black/45"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="kvasir-overview-title"
        className="kvasir-dialog w-[420px] max-w-[92vw] rounded-xl border border-border bg-background p-4 text-foreground shadow-2xl"
      >
        <div id="kvasir-overview-title" className="mb-2 text-base font-semibold">
          Overview
        </div>
        <p className="mb-3 whitespace-pre-line text-sm leading-relaxed text-foreground">{overview}</p>
        <Button variant="ghost" size="sm" className="w-full" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
