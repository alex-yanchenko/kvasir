// Arrow keys navigate a guide's steps. One hook for both tabs: the guide's own
// canNext/canBack carry ALL the gating (edges; for reviews also "a cross-file
// navigation is in flight"), so the keys can never move where the buttons
// wouldn't. Shadow-aware binding + editable-target skip live in the inner hook.
import { useShadowAwareKeydown } from "./useShadowAwareKeydown";

export interface ArrowNav {
  canNext(): boolean;
  canBack(): boolean;
  next(): void;
  back(): void;
}

export function useArrowKeyNav(nav: ArrowNav): void {
  useShadowAwareKeydown((event) => {
    if (event.key === "ArrowRight" && nav.canNext()) {
      event.preventDefault();
      nav.next();
    } else if (event.key === "ArrowLeft" && nav.canBack()) {
      event.preventDefault();
      nav.back();
    }
  });
}
