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
