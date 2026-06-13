// Observe a panel's size and persist it, debounced — the React port of the
// vanilla ResizeObserver + 300ms timer pattern.
import type { RefObject } from "react";
import { useEffect, useRef } from "react";

export function useResizePersist(
  targetRef: RefObject<HTMLElement | null>,
  onSize: (size: { w: number; h: number }) => void,
  delay = 300,
): void {
  // Latest onSize in a ref so re-subscribing the observer isn't triggered by the
  // caller passing a fresh inline callback every render.
  const onSizeRef = useRef(onSize);
  onSizeRef.current = onSize;
  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (t) clearTimeout(t);
      t = setTimeout(() => onSizeRef.current({ w: el.offsetWidth, h: el.offsetHeight }), delay);
    });
    ro.observe(el);
    return () => {
      if (t) clearTimeout(t);
      ro.disconnect();
    };
  }, [targetRef, delay]);
}
