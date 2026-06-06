// Fetch proxy: content scripts are subject to the page's CORS, so we route all
// calls to the local channel server through the service worker, which has
// host_permissions for localhost and can fetch cross-origin freely.

const PORT = 8799;
const BASE = `http://localhost:${PORT}`;

interface BridgeRequest {
  path: string;
  method?: string;
  body?: unknown;
}

interface BridgeResponse {
  ok: boolean;
  status?: number;
  data?: unknown;
  error?: string;
}

chrome.runtime.onMessage.addListener(
  (msg: BridgeRequest, _sender, sendResponse: (response: BridgeResponse) => void) => {
    void (async () => {
      try {
        // The guard header marks this as a call from the extension. A web page can't
        // set a custom header on a simple cross-origin request, so the local server
        // rejects anything without it — closing the door on malicious-site CSRF.
        const opts: RequestInit = {
          method: msg.method ?? "GET",
          headers: { "content-type": "application/json", "x-pr-walkthrough": "1" },
        };
        if (msg.body) opts.body = JSON.stringify(msg.body);
        const res = await fetch(BASE + msg.path, opts);
        const data: unknown = await res.json();
        sendResponse({ ok: res.ok, status: res.status, data });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // keep the message channel open for the async response
  },
);
