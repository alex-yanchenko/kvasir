// Keyboard shield for the shadow host. Events bubbling out of the shadow root
// are retargeted to the host <div>, so GitHub's document-level hotkey handlers
// see "a keypress on a div" — not on our textarea — and fire ("/" focuses the
// site search while you type in the chat). Stopping keyboard events at the host
// keeps them inside Asgard; React's own handlers live on the mount below the
// host, so they have already run.
const KEY_EVENTS = ["keydown", "keypress", "keyup"] as const;
const stopEvent = (event: Event): void => event.stopPropagation();

export function shieldHotkeys(host: HTMLElement): () => void {
  for (const type of KEY_EVENTS) host.addEventListener(type, stopEvent);
  return () => {
    for (const type of KEY_EVENTS) host.removeEventListener(type, stopEvent);
  };
}
