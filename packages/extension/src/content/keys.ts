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
export const panelKey = (pr: string | null): string => `prw:panel:${pr}`;

/** The bridge token's storage key — global, not per-PR (one bridge per machine). */
export const TOKEN_KEY = "prw:token";
