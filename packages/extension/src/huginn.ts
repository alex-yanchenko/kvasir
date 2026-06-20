// Fetch proxy: content scripts are subject to the page's CORS, so we route all
// calls to the local channel server through the service worker, which has
// host_permissions for localhost and can fetch cross-origin freely.

const PORT = 8799;
const BASE = `http://localhost:${PORT}`;

// The bridge routes this worker is allowed to proxy to. Validating the path (and
// that it resolves to the localhost bridge origin) stops a compromised in-page
// content script from borrowing the worker's pairing token to hit an unintended
// route, or — via a protocol-relative path like "//evil.com" — an off-origin host.
const ALLOWED_PATHS = new Set([
  "/health",
  "/auth",
  "/pair",
  "/pair/claim",
  "/push",
  "/history",
  "/review",
  "/entry",
  "/entries",
  "/walkthrough",
  "/head",
  "/generate",
  "/ask",
  "/poll",
  "/suggest",
]);

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
  (message: BridgeRequest, sender, sendResponse: (response: BridgeResponse) => void) => {
    // Only this extension's own content scripts may use the proxy. There is no
    // externally_connectable, so a web page can't reach here anyway — defense in depth.
    if (sender.id !== chrome.runtime.id) {
      sendResponse({ ok: false, error: "forbidden sender" });
      return false;
    }
    void (async () => {
      try {
        // Resolve + allowlist the path: must land on the localhost bridge origin and
        // be a known route. A protocol-relative ("//host") or absolute path that
        // would escape the bridge origin fails the origin check and is refused.
        const target = new URL(message.path, BASE);
        if (target.origin !== BASE || !ALLOWED_PATHS.has(target.pathname)) {
          sendResponse({ ok: false, error: "blocked path" });
          return;
        }
        // The pairing token (absent until the user pairs — the bridge is open then).
        const stored = await chrome.storage.local.get("kvasir:token");
        const token = typeof stored["kvasir:token"] === "string" ? stored["kvasir:token"] : "";
        // The guard header marks this as a call from the extension. A web page can't
        // set a custom header on a simple cross-origin request, so the local server
        // rejects anything without it — closing the door on malicious-site CSRF.
        const options: RequestInit = {
          method: message.method ?? "GET",
          headers: {
            "content-type": "application/json",
            "x-kvasir": "1",
            ...(token ? { "x-kvasir-token": token } : {}),
          },
        };
        if (message.body) options.body = JSON.stringify(message.body);
        const resolve = await fetch(target, options);
        const data: unknown = await resolve.json();
        sendResponse({ ok: resolve.ok, status: resolve.status, data });
      } catch (error) {
        sendResponse({ ok: false, error: String(error) });
      }
    })();
    return true; // keep the message channel open for the async response
  },
);
