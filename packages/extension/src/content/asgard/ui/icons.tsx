// The rail's icon set — the redesign's 16×16 stroke glyphs (tour / chat /
// history / settings), drawn on currentColor so active/hover states color them
// via the parent. Hand-rolled (not lucide) so the stroke style stays uniform;
// sized by the parent's [&_svg] utility.
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
  // gear = hub + ring + teeth (rays alone read as a sun)
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="2.1" fill="none" stroke="currentColor" strokeWidth={1.5} />
      <circle cx="8" cy="8" r="4.9" fill="none" stroke="currentColor" strokeWidth={1.5} />
      <path
        d="M13 8h1.6M8 13v1.6M3 8H1.4M8 3V1.4M11.5 11.5l1.1 1.1M4.5 4.5L3.4 3.4M11.5 4.5l1.1-1.1M4.5 11.5l-1.1 1.1"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </svg>
  );
}
