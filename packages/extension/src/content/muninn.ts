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

// chrome.storage.onChanged fires in EVERY tab/context when local storage changes —
// the built-in cross-tab signal. onStored watches one key and hands the handler its
// new value (undefined when the key was removed). Returns an unsubscribe fn.
type StorageChange = { newValue?: unknown };
type StorageListener = (changes: Record<string, StorageChange>, area: string) => void;
const NOOP = (): void => {};
export const onStored = (key: string, handler: (value: unknown) => void): (() => void) => {
  const listener: StorageListener = (changes, area) => {
    if (area === "local" && key in changes) handler(changes[key]?.newValue);
  };
  try {
    chrome.storage?.onChanged?.addListener(listener);
  } catch {
    return NOOP; // orphaned context — nothing to unsubscribe
  }
  return () => {
    try {
      chrome.storage?.onChanged?.removeListener(listener);
    } catch {
      /* context gone */
    }
  };
};
