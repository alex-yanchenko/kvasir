// Debug escape hatch: wipe every bit of extension-owned CLIENT state — the
// chrome.storage.local `kvasir:` keys (token, history, seen, chats, specs, tours,
// panel geometry) plus the page-origin localStorage settings and sessionStorage
// review snapshots. The backend store (~/.kvasir/kvasir.db) is NOT touched; reload
// the page after wiping. Best-effort throughout (an orphaned context just no-ops).
const LOCAL_SETTINGS_KEYS = ["kvasirTheme", "kvasirHl", "kvasirReviewSync"];

export async function wipeStoredData(): Promise<void> {
  try {
    const local = chrome.storage?.local;
    if (local) {
      const all = await local.get(null);
      await local.remove(Object.keys(all).filter((key) => key.startsWith("kvasir:")));
    }
  } catch {
    /* orphaned extension context / storage unavailable */
  }
  try {
    for (const key of LOCAL_SETTINGS_KEYS) localStorage.removeItem(key);
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith("kvasir:")) sessionStorage.removeItem(key);
    }
  } catch {
    /* web storage unavailable */
  }
}
