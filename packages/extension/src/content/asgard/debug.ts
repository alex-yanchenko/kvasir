// Debug escape hatch: a real wipe of the stored walkthroughs plus every bit of
// extension-owned CLIENT state. First DELETE /entries on the backend store
// (~/.kvasir/kvasir.db) so the walkthroughs don't just re-fetch on reload; then
// clear the chrome.storage.local `kvasir:` keys (token, history, seen, chats,
// specs, tours, panel geometry) plus the page-origin localStorage settings and
// sessionStorage review snapshots. Only THIS browser is unpaired (its local token
// drops); server pairing rows survive — full reset is the wipe-all script's job.
// Best-effort throughout (an orphaned context or a down channel just no-ops).
import { api } from "../api";
import { HISTORY_KEY } from "../keys";
import { storeSet } from "../muninn";

const LOCAL_SETTINGS_KEYS = ["kvasirTheme", "kvasirHl", "kvasirReviewSync"];

export async function wipeStoredData(): Promise<void> {
  // Hard-wipe the backend first; api never rejects, so a down channel is a
  // silent no-op and local state still clears below.
  await api("/entries", "DELETE");
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
  // LAST write: set HISTORY_KEY to [] (not remove). A removal fires onChanged with
  // newValue=undefined, which observeExternal treats as null and ignores; writing
  // [] fires it with newValue=[] → observeExternal([]) → invalidateActiveGuide in
  // every tab (incl. this one), raising "This walkthrough was deleted."
  storeSet(HISTORY_KEY, []);
}
