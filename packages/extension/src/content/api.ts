// Bridge client: content scripts inherit the page's CORS, so every call to the
// local channel server is routed through the background service worker (which
// holds the localhost host_permission and sets the x-kvasir guard
// header). This just posts a message and resolves with the worker's reply.

export interface BridgeResponse {
  ok: boolean;
  status?: number;
  data?: unknown;
  error?: string;
}

/** Transport-level failure: the call never produced an HTTP status — fetch threw,
 * the worker didn't answer, etc. An HTTP error (any status) means something IS
 * listening on the bridge port, so only a status-less failure reads as "down". */
export const isUnreachable = (r: BridgeResponse): boolean => !r.ok && r.status === undefined;

export const api = (path: string, method = "GET", body: unknown = null): Promise<BridgeResponse> =>
  new Promise((resolve) => {
    // If the extension was reloaded, this content script is orphaned — fail
    // quietly instead of throwing "Extension context invalidated".
    if (!chrome.runtime?.id) {
      resolve({ ok: false, error: "extension reloaded — refresh the page" });
      return;
    }
    try {
      chrome.runtime.sendMessage({ path, method, body }, (r: BridgeResponse) => {
        const error = chrome.runtime?.lastError; // optional — runtime may be gone by now
        if (error) {
          resolve({ ok: false, error: error.message ?? "extension messaging error" });
          return;
        }
        resolve(r || { ok: false, error: "no response" });
      });
    } catch (error) {
      resolve({ ok: false, error: String(error) });
    }
  });
