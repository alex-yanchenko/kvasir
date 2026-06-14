// Thin chrome.storage.local wrapper. Reads resolve to undefined (never reject) so
// callers can treat "missing" and "storage unavailable" alike; writes are
// fire-and-forget. The per-PR key builders live in keys.ts; restore in heimdall/watch.ts.

export const storeGet = (k: string): Promise<unknown> =>
  new Promise((resolve) => {
    try {
      const local = chrome.storage?.local;
      if (!local) {
        resolve(undefined); // orphaned context: settle rather than hang forever
        return;
      }
      local.get(k, (o) => resolve(o?.[k]));
    } catch {
      resolve(undefined);
    }
  });
export const storeSet = (k: string, v: unknown): void => {
  void (async () => {
    try {
      await chrome.storage?.local?.set({ [k]: v });
    } catch {
      /* best-effort persistence: ignore sync throws AND async rejection */
    }
  })();
};
export const storeRemove = (k: string): void => {
  void (async () => {
    try {
      await chrome.storage?.local?.remove(k);
    } catch {
      /* best-effort persistence: ignore sync throws AND async rejection */
    }
  })();
};
