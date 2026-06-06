// Drag a panel by a handle: mouse events + direct style writes through a ref —
// zero re-renders during the drag; one onEnd with the final position for the
// store to persist. (Mouse, not pointer, events: identical to the vanilla
// behavior and constructible in jsdom.)
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";

interface DragOptions {
  /** Selector for child elements that must not start a drag (buttons etc.). */
  ignore?: string;
  onMoved?: () => void;
  onEnd: (pos: { left: number; top: number }) => void;
}

export function useDrag(
  targetRef: RefObject<HTMLElement | null>,
  opts: DragOptions,
): (e: ReactMouseEvent) => void {
  return (e) => {
    const el = targetRef.current;
    if (!el) return;
    if (opts.ignore && e.target instanceof Element && e.target.closest(opts.ignore)) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const ox = e.clientX - r.left;
    const oy = e.clientY - r.top;
    const move = (ev: MouseEvent) => {
      opts.onMoved?.();
      el.style.left = `${ev.clientX - ox}px`;
      el.style.top = `${ev.clientY - oy}px`;
      el.style.right = "auto";
      el.style.bottom = "auto";
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      const b = el.getBoundingClientRect();
      opts.onEnd({ left: b.left, top: b.top });
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };
}
