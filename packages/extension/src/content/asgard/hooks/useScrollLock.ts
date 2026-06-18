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
  if (size <= client) return false;
  const pos = axis === "y" ? node.scrollTop : node.scrollLeft;
  return delta < 0 ? pos > 0 : pos + client < size;
}

export function useScrollLock(targetRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = targetRef.current;
    if (!root) return;
    const onWheel = (event: WheelEvent): void => {
      const start = event.target instanceof HTMLElement ? event.target : null;
      for (let node = start; node; node = node.parentElement) {
        // Let it through if an inner scroller can move in an axis the wheel actually
        // pushes (only a non-zero-delta axis counts), else swallow at the panel edge.
        if (
          (event.deltaY !== 0 && canScroll(node, "y", event.deltaY)) ||
          (event.deltaX !== 0 && canScroll(node, "x", event.deltaX))
        )
          return;
        if (node === root) break; // reached the panel edge without finding room
      }
      event.preventDefault(); // nothing inside can scroll further → don't scroll the page
    };
    // non-passive so preventDefault actually blocks the scroll
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [targetRef]);
}
