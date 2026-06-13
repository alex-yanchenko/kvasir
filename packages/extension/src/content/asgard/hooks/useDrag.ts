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
  options: DragOptions,
): (event: ReactMouseEvent) => void {
  return (event) => {
    const element = targetRef.current;
    if (!element) return;
    if (options.ignore && event.target instanceof Element && event.target.closest(options.ignore)) return;
    event.preventDefault();
    const r = element.getBoundingClientRect();
    const ox = event.clientX - r.left;
    const oy = event.clientY - r.top;
    const move = (event: MouseEvent) => {
      options.onMoved?.();
      element.style.left = `${event.clientX - ox}px`;
      element.style.top = `${event.clientY - oy}px`;
      element.style.right = "auto";
      element.style.bottom = "auto";
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      const b = element.getBoundingClientRect();
      options.onEnd({ left: b.left, top: b.top });
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };
}
