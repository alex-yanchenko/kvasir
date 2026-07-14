// The rail's icon set — the redesign's canonical 16×16 stroke glyphs (tour /
// chat / history / settings), drawn on currentColor so active/hover states color
// them via the parent. Kept hand-rolled (not lucide) to match the mockup kit
// exactly; sized by the parent's [&_svg] utility.
import type { JSX } from "react";

export function IconTour(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2 3h12M2 8h8M2 13h12"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconChat(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 3h10v8H7l-3 3v-3H3z"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconHistory(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth={1.6} />
      <path d="M8 5v3l2 2" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
    </svg>
  );
}

export function IconSettings(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="2.4" fill="none" stroke="currentColor" strokeWidth={1.6} />
      <path
        d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6L11 5M5 11l-1.4 1.4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
      />
    </svg>
  );
}
