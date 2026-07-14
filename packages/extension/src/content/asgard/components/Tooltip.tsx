// Fast tooltips for Asgard. The native title attribute can't cross the shadow
// boundary reliably (event retargeting) and waits ~1s; this shows a styled tip
// ~350ms after hovering any [data-kvasir-tip] element inside the shadow root.
// Rendered once by App; finds its root via getRootNode so the same component
// works under a shadow root (production) and under document (tests).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { JSX } from "react";

export const TIP_DELAY_MS = 350;
/** Slow tier for always-visible chrome (the icon rail): long enough that the tip
 * doesn't flash on every pass, short enough that hover-and-wait still answers.
 * Opt in per element via data-kvasir-tip-delay. */
export const TIP_DELAY_LONG_MS = 900;

interface TipState {
  text: string;
  anchor: DOMRect;
}

export function Tooltips(): JSX.Element {
  const probeRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tip, setTip] = useState<TipState | null>(null);

  useEffect(() => {
    const root = probeRef.current!.getRootNode();
    const cancel = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      setTip(null);
    };
    const over = (event: Event) => {
      const t =
        event.target instanceof Element ? event.target.closest<HTMLElement>("[data-kvasir-tip]") : null;
      if (!t) return;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(
        // closest matched [data-kvasir-tip], so the attribute is always present
        () => setTip({ text: String(t.dataset.kvasirTip), anchor: t.getBoundingClientRect() }),
        Number(t.dataset.kvasirTipDelay) || TIP_DELAY_MS,
      );
    };
    const out = (event: Event) => {
      if (!(event instanceof MouseEvent) || !(event.target instanceof Element)) return;
      const owner = event.target.closest("[data-kvasir-tip]");
      // mouseout fires on parent->child crossings (the icon svg); don't cancel while
      // still inside the same tip owner.
      if (!owner || (event.relatedTarget instanceof Node && owner.contains(event.relatedTarget))) return;
      cancel();
    };
    root.addEventListener("mouseover", over);
    root.addEventListener("mouseout", out);
    root.addEventListener("mousedown", cancel, true);
    return () => {
      root.removeEventListener("mouseover", over);
      root.removeEventListener("mouseout", out);
      root.removeEventListener("mousedown", cancel, true);
    };
  }, []);

  // Position after render: the tip must be measured to center it on the anchor
  // and to flip below when it would poke past the viewport top.
  useLayoutEffect(() => {
    if (!tip) return;
    const element = tipRef.current!; // the tip div renders whenever tip is set
    const r = tip.anchor;
    const tr = element.getBoundingClientRect();
    let top = r.top - tr.height - 6;
    if (top < 4) top = r.bottom + 6;
    const left = Math.max(6, Math.min(r.left + r.width / 2 - tr.width / 2, window.innerWidth - tr.width - 6));
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  }, [tip]);

  return (
    <>
      <span ref={probeRef} hidden />
      {tip && (
        <div ref={tipRef} role="tooltip" className="kvasir-tip">
          {tip.text}
        </div>
      )}
    </>
  );
}
