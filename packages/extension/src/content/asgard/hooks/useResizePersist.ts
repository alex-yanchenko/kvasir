// Observe a panel's size and persist it — a ResizeObserver debounced by a
// 300ms timer, so mid-drag intermediate sizes never hit storage.
import { useEffect, useRef } from "react";
import type { RefObject } from "react";

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
    const element = targetRef.current;
    if (!element) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      if (t) clearTimeout(t);
      t = setTimeout(() => onSizeRef.current({ w: element.offsetWidth, h: element.offsetHeight }), delay);
    });
    ro.observe(element);
    return () => {
      if (t) clearTimeout(t);
      ro.disconnect();
    };
  }, [targetRef, delay]);
}
