// Radix primitives (shadcn Dialog/DropdownMenu/Popover/Select/Tooltip) portal to
// document.body by default — which is OUTSIDE the shadow root, where Asgard's
// compiled Tailwind never reaches, so they'd render unstyled in the light DOM.
// This context hands every copied-in component a container node that lives inside
// the shadow root; each component passes it to its Radix <Portal container={...}>.
import type { JSX, ReactNode } from "react";
import { createContext, useContext } from "react";

const PortalContainerContext = createContext<HTMLElement | null>(null);

export function PortalContainerProvider({
  container,
  children,
}: {
  container: HTMLElement | null;
  children: ReactNode;
}): JSX.Element {
  return <PortalContainerContext.Provider value={container}>{children}</PortalContainerContext.Provider>;
}

/** The shadow-internal node Radix portals must mount into. Null only before boot
 * wires it (never in practice once <App/> is mounted). */
export function usePortalContainer(): HTMLElement | null {
  return useContext(PortalContainerContext);
}
