// Pure helpers shared by the store and the (shrinking) vanilla world: the
// per-PR storage keys and the location readers. Keys embed the PR url so every
// PR keeps its own chats/spec/tour/generation marker.

export const prUrl = (): string | null => {
  const m = /(https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+)/.exec(location.href);
  return m?.[1] ?? null;
};

// GitHub's newer PR UI serves the diff at /changes; older at /files. Accept both.
export const onFilesTab = (): boolean => /\/pull\/\d+\/(?:files|changes)/.test(location.href);

export const chatsKey = (pr: string | null): string => `prw:chats:${pr}`;
export const specKey = (pr: string | null): string => `prw:spec:${pr}`;
export const tourKey = (pr: string | null): string => `prw:tour:${pr}`;
export const genKey = (pr: string | null): string => `prw:gen:${pr}`;
/** The panel's per-tab state (open · tab · pos · size), stored in sessionStorage so
 * it survives refresh + same-tab navigation, stays independent per tab, and is
 * inherited by a child tab (the browser copies sessionStorage on open). NOT global —
 * a global key clobbered across tabs and reopened the panel everywhere. */
export const PANEL_STATE_KEY = "prw:panel";

/** The bridge token's storage key — global, not per-PR (one bridge per machine). */
export const TOKEN_KEY = "prw:token";

/** A pushed review's id, carried on the GitHub landing URL as `?prw=<id>` — how
 * the extension knows a page is a review (vs a plain PR) and which one to pull. */
export const reviewIdFromUrl = (): string | null => {
  const m = /[?&]prw=([^&#]+)/.exec(location.href);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null; // malformed percent-escape (e.g. ?prw=%) — not a usable id
  }
};

/** Per-review cache key (survives the page loads a review walks through). */
export const reviewKey = (id: string): string => `prw:review:${id}`;

/** Per-review SESSION snapshot key. sessionStorage is synchronous and survives a
 * same-origin navigation, so the next page can hydrate the panel (review + step +
 * geometry) on its first paint — no async pop-in/blink. */
export const reviewSessionKey = (id: string): string => `prw:session:${id}`;

/** Cache key for the history list (GET /history) — for instant paint. */
export const HISTORY_KEY = "prw:history";

/** Per-id "last version the FE has caught up to" map (Record<id, version>), so the
 * History tab can flag entries whose backend content advanced past what we showed. */
export const SEEN_KEY = "prw:seen";
