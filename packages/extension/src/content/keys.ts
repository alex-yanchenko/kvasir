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
/** Panel geometry is GLOBAL (one key for every PR/review/page), so the panel keeps
 * its position + size as you move between pages instead of snapping to default. */
export const PANEL_GEOM_KEY = "prw:panel";

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
