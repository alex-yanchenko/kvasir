// Same-origin navigation helpers shared by review-mode (blob-page nav) and the
// walkthrough's jump-to-code (Conversation → Files). Kept here so neither machine
// owns the other's copy.

/** Drive GitHub's OWN client router via a synthetic same-origin link click → a soft
 * nav: no reload, so our (body-level) panel survives. GitHub intercepts these within a
 * repo; cross-repo it falls back to a hard load, which callers handle separately. */
export const softNavigate = (href: string): void => {
  const link = document.createElement("a");
  link.href = href;
  document.body.append(link);
  link.click();
  link.remove();
};

/** Poll until GitHub's soft nav lands on the target path (or ~3s timeout), then run
 * onArrive — used to advance the panel only once the new page is in. */
export const awaitSoftNav = (targetPath: string, onArrive: () => void): void => {
  let tries = 0;
  const poll = setInterval(() => {
    if (decodeURIComponent(globalThis.location.pathname) === targetPath || ++tries > 40) {
      clearInterval(poll);
      onArrive();
    }
  }, 80);
};
