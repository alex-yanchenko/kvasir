// Pure helpers shared across realms: storage keys and the location readers.
// spec/tour/gen keys embed the PR url so every PR keeps its own state; chats key
// off the broader chatScope (the PR url, or a pushed review's id on blob pages).

export const prUrl = (): string | null => {
  const m = /(https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+)/.exec(location.href);
  return m?.[1] ?? null;
};

// GitHub's newer PR UI serves the diff at /changes; older at /files. Accept both.
export const onFilesTab = (): boolean => /\/pull\/\d+\/(?:files|changes)/.test(location.href);

export const chatsKey = (scope: string | null): string => `kvasir:chats:${scope}`;
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

/** The active guide's chat-storage scope: the pushed review's id on `?kvasir=`
 * pages, else the PR url, else null — the review wins so the precedence matches
 * activeGuide() (which renders the review guide whenever the id is present, even
 * on a URL that is also a PR page). Null means there is no guide to key chats
 * under — persist NOTHING rather than write a shared "kvasir:chats:null" bucket
 * no page ever reads back. */
export const chatScope = (): string | null => reviewIdFromUrl() ?? prUrl();

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
