// Fetch proxy: content scripts are subject to the page's CORS, so we route all
// calls to the local channel server through the service worker, which has
// host_permissions for localhost and can fetch cross-origin freely. The path
// allowlist + origin check live in bridgeRoutes (pure + unit-tested).
import { bridgeTarget } from "./content/bridgeRoutes";
import { TOKEN_KEY } from "./content/keys";

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
        // Resolve + allowlist the path: it must land on the localhost bridge origin
        // and be a known route (rejects off-origin / protocol-relative escapes).
        const target = bridgeTarget(message.path);
        if (!target) {
          sendResponse({ ok: false, error: "blocked path" });
          return;
        }
        // The pairing token (absent until the user pairs — the bridge is open then).
        const stored = await chrome.storage.local.get(TOKEN_KEY);
        const token = typeof stored[TOKEN_KEY] === "string" ? stored[TOKEN_KEY] : "";
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
        try {
          const data: unknown = await resolve.json();
          sendResponse({ ok: resolve.ok, status: resolve.status, data });
        } catch (error) {
          // A non-JSON body on a real HTTP response (e.g. the runtime's default
          // 500 page from a throwing route) must keep its status — a status-less
          // reply reads as "channel down" to the client (isUnreachable).
          sendResponse({ ok: false, status: resolve.status, error: String(error) });
        }
      } catch (error) {
        sendResponse({ ok: false, error: String(error) });
      }
    })();
    return true; // keep the message channel open for the async response
  },
);
