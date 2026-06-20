import type { JSX } from "react";

/** The Kvasir logo mark — the carved Kenaz-style chevron + spark — as an inline
 * SVG that paints in `currentColor`, so it tints to whatever text color it sits
 * in (white on the teal launcher, the primary in the panel header). Same geometry
 * as icons/kvasir.svg. */
export function KvasirMark({ className }: Readonly<{ className?: string }>): JSX.Element {
  return (
    <svg viewBox="0 0 128 128" className={className} fill="currentColor" aria-hidden="true">
      <g transform="translate(128 0) scale(-1 1)">
        <polygon points="80,14 97,24 50,64 97,104 80,114 36,64" />
        <rect x="61" y="55" width="18" height="18" transform="rotate(45 70 64)" />
      </g>
    </svg>
  );
}
