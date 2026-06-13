// Keep the page from scrolling while the cursor is over the panel. A scrollable
// region inside the panel still scrolls; only once nothing inside can move
// further (or the cursor is over a non-scrolling area) do we swallow the wheel,
// so GitHub behind the panel never scrolls. overscroll-behavior alone can't do
// this — it only stops chaining out of an actual scroll container, not wheels
// over the header/padding/empty areas.
import { useEffect } from "react";
import type { RefObject } from "react";

/** An element that can still scroll vertically in the wheel's direction. */
function canScroll(node: HTMLElement, deltaY: number): boolean {
  if (!/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return false;
  if (node.scrollHeight <= node.clientHeight) return false;
  return deltaY < 0 ? node.scrollTop > 0 : node.scrollTop + node.clientHeight < node.scrollHeight;
}

export function useScrollLock(targetRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = targetRef.current;
    if (!root) return;
    const onWheel = (e: WheelEvent): void => {
      for (let node = e.target as HTMLElement | null; node; node = node.parentElement) {
        if (canScroll(node, e.deltaY)) return; // an inner scroller will consume it
        if (node === root) break; // reached the panel edge without finding room
      }
      e.preventDefault(); // nothing inside can scroll further → don't scroll the page
    };
    // non-passive so preventDefault actually blocks the scroll
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [targetRef]);
}
