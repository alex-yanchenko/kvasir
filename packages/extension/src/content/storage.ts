// Thin chrome.storage.local wrapper. Reads resolve to undefined (never reject) so
// callers can treat "missing" and "storage unavailable" alike; writes are
// fire-and-forget. The per-PR key builders and load logic live in content.js.

export const storeGet = (k: string): Promise<unknown> =>
  new Promise((res) => {
    try {
      chrome.storage?.local?.get(k, (o) => res(o?.[k]));
    } catch {
      res(undefined);
    }
  });
export const storeSet = (k: string, v: unknown): void => {
  try {
    chrome.storage?.local?.set({ [k]: v });
  } catch {
    /* ignore */
  }
};
export const storeRemove = (k: string): void => {
  try {
    chrome.storage?.local?.remove(k);
  } catch {
    /* ignore */
  }
};
