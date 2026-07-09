// Keep the page from scrolling while the cursor is over the panel. A scrollable
// region inside the panel still scrolls; only once nothing inside can move
// further (or the cursor is over a non-scrolling area) do we swallow the wheel,
// so GitHub behind the panel never scrolls. overscroll-behavior alone can't do
// this — it only stops chaining out of an actual scroll container, not wheels
// over the header/padding/empty areas.
import { useEffect } from "react";
import type { RefObject } from "react";

/** Whether `node` can still scroll along one axis in the wheel's direction. Handles
 * both axes so a horizontal wheel (deltaX) over a horizontally-scrolling region — e.g.
 * the sidebar's long file/step rows — isn't swallowed along with vertical locking. */
function canScroll(node: HTMLElement, axis: "x" | "y", delta: number): boolean {
  const style = getComputedStyle(node);
  if (!/auto|scroll/.test(axis === "y" ? style.overflowY : style.overflowX)) return false;
  const size = axis === "y" ? node.scrollHeight : node.scrollWidth;
  const client = axis === "y" ? node.clientHeight : node.clientWidth;
  const pos = axis === "y" ? node.scrollTop : node.scrollLeft;
  // Room in the wheel's direction, with a 1px sub-pixel tolerance: under browser
  // zoom / display scaling scrollTop is FRACTIONAL while scrollHeight/clientHeight
  // round to integers, so a scroller at its true end reports <1px of phantom room.
  // Counting that as scrollable lets the wheel through, and the browser — finding
  // nothing that actually moves — chains the scroll to the PAGE behind the panel.
  const room = delta < 0 ? pos : size - client - pos;
  return room > 1;
}

export function useScrollLock(targetRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = targetRef.current;
    if (!root) return;
    const onWheel = (event: WheelEvent): void => {
      // Lock against the wheel's DOMINANT axis: cross-axis noise (a small deltaX on a
      // mostly-vertical scroll, or vice-versa) must not leak a page scroll. Only let it
      // through if an inner element can scroll that axis.
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      const axis = horizontal ? "x" : "y";
      const delta = horizontal ? event.deltaX : event.deltaY;
      const start = event.target instanceof HTMLElement ? event.target : null;
      for (let node = start; node; node = node.parentElement) {
        if (canScroll(node, axis, delta)) return; // an inner scroller will consume it
        if (node === root) break; // reached the panel edge without finding room
      }
      event.preventDefault(); // nothing inside can scroll further → don't scroll the page
    };
    // non-passive so preventDefault actually blocks the scroll
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [targetRef]);
}
