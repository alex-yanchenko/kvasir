// Pure helpers shared across realms: the per-PR storage keys and the location
// readers. Keys embed the PR url so every PR keeps its own chats/spec/tour/
// generation marker.

export const prUrl = (): string | null => {
  const m = /(https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+)/.exec(location.href);
  return m?.[1] ?? null;
};

// GitHub's newer PR UI serves the diff at /changes; older at /files. Accept both.
export const onFilesTab = (): boolean => /\/pull\/\d+\/(?:files|changes)/.test(location.href);

export const chatsKey = (pr: string | null): string => `kvasir:chats:${pr}`;
export const specKey = (pr: string | null): string => `kvasir:spec:${pr}`;
export const tourKey = (pr: string | null): string => `kvasir:tour:${pr}`;
export const genKey = (pr: string | null): string => `kvasir:gen:${pr}`;
/** The panel's per-tab state (open · tab · pos · size), stored in sessionStorage so
 * it survives refresh + same-tab navigation, stays independent per tab, and is
 * inherited by a child tab (the browser copies sessionStorage on open). NOT global —
 * a global key clobbered across tabs and reopened the panel everywhere. */
export const PANEL_STATE_KEY = "kvasir:panel";

/** The bridge token's storage key — global, not per-PR (one bridge per machine). */
export const TOKEN_KEY = "kvasir:token";

/** True only for an absolute `https://github.com` URL — the single origin the panel
 * ever navigates to. Guards a `location` assignment against an off-origin redirect
 * smuggled in through a stored entry's url (the `/history` response is data we render,
 * so it's treated as untrusted at the navigation boundary). */
export const isGithubHttpsUrl = (url: string): boolean => {
  try {
    return new URL(url).origin === "https://github.com";
  } catch {
    return false; // not an absolute/parseable URL
  }
};

/** A pushed review's id, carried on the GitHub landing URL as `?kvasir=<id>` — how
 * the extension knows a page is a review (vs a plain PR) and which one to pull. */
export const reviewIdFromUrl = (): string | null => {
  const m = /[?&]kvasir=([^&#]+)/.exec(location.href);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null; // malformed percent-escape (e.g. ?kvasir=%) — not a usable id
  }
};

/** Per-review cache key (survives the page loads a review walks through). */
export const reviewKey = (id: string): string => `kvasir:review:${id}`;

/** Per-review SESSION snapshot key. sessionStorage is synchronous and survives a
 * same-origin navigation, so the next page can hydrate the panel (review + step +
 * geometry) on its first paint — no async pop-in/blink. */
export const reviewSessionKey = (id: string): string => `kvasir:session:${id}`;

/** Cache key for the history list (GET /history) — for instant paint. */
export const HISTORY_KEY = "kvasir:history";

/** Per-id "last version the FE has caught up to" map (Record<id, version>), so the
 * History tab can flag entries whose backend content advanced past what we showed. */
export const SEEN_KEY = "kvasir:seen";
