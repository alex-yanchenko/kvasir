// A stand-in for the Mimir channel server on the port the extension's service
// worker (huginn.ts) hard-codes. It must be a REAL server — Playwright's
// page.route only intercepts page-origin requests, never the worker's
// cross-origin fetch.
//
// Crucially this does NOT hand-mirror Mimir's wire contract: it runs the REAL
// bridge handler (createFetchHandler) over the REAL pairing + ask-broker, all of
// which are pure Node (no Bun). The only things faked are the session-side steps
// a human + Claude session would perform — approving the pairing code, and
// answering a question — so the response ENVELOPES can't drift from production.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { prKey, type WalkthroughSpec } from "../packages/runes/src/index";
import { createFetchHandler, type BridgeDeps } from "../packages/mimir/src/bridge";
import { createAskBroker } from "../packages/mimir/src/broker";
import { createPairing, type Pairing } from "../packages/mimir/src/pairing";

const PORT = 8799;

export interface BridgeState {
  answer: string;
  suggestions: string[];
  headSha: string;
}

export interface BridgeStub {
  state: BridgeState;
  // The real bridge token, minted through the actual pairing handshake at startup.
  // Seed it into the worker's storage (see fixtures.pair) to start a test "paired".
  token: string;
  // Publish a spec the way a generation would: keyed by its PR, served by /walkthrough.
  setSpec: (spec: WalkthroughSpec) => void;
  close: () => Promise<void>;
}

const toRequest = async (req: IncomingMessage): Promise<Request> => {
  const host = req.headers.host ?? `localhost:${PORT}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
  }
  const method = req.method ?? "GET";
  let body: string | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = Buffer.concat(chunks).toString("utf8") || undefined;
  }
  return new Request(`http://${host}${req.url ?? "/"}`, { method, headers, body });
};

const sendResponse = async (res: ServerResponse, response: Response): Promise<void> => {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers);
  res.end(await response.text());
};

export async function startBridge(overrides: Partial<BridgeState> = {}): Promise<BridgeStub> {
  const state: BridgeState = { answer: "", suggestions: [], headSha: "sha-baseline", ...overrides };
  const specs = new Map<string, WalkthroughSpec>();

  // Real pairing, but the "user" instantly approves the code each /pair returns —
  // standing in for the confirm-in-your-session step.
  const realPairing = createPairing({ pushEvent: async () => {} });
  const pairing: Pairing = {
    ...realPairing,
    request: (name) => {
      const r = realPairing.request(name);
      if (r.ok) realPairing.approve(r.code);
      return r;
    },
  };

  // Real ask broker, but the "session" answers immediately with state.answer —
  // standing in for Claude calling answer_question. /poll then streams it back.
  const broker = createAskBroker({ timeoutMs: 30_000, pushEvent: async () => {} });

  const deps: BridgeDeps = {
    specs,
    pairing,
    open: (eventType, content, meta) => {
      const id = broker.open(eventType, content, meta);
      queueMicrotask(() => broker.finish(id, state.answer));
      return id;
    },
    ask: async () => JSON.stringify(state.suggestions),
    snapshot: (id) => broker.snapshot(id),
    pushEvent: async () => {},
    getHeadSha: async () => state.headSha,
  };

  // Mint a real token via the actual handshake (request auto-approves, then claim),
  // so a seeded-token test is genuinely paired against this pairing instance.
  const booted = pairing.request("e2e harness");
  const claimed = booted.ok ? pairing.claim(booted.requestId) : null;
  const token = claimed && "token" in claimed ? claimed.token : "";

  const handler = createFetchHandler(deps);
  const server: Server = createServer((req, res) => {
    void (async () => {
      try {
        await sendResponse(res, await handler(await toRequest(req)));
      } catch {
        res.writeHead(500).end();
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, resolve);
  });

  return {
    state,
    token,
    setSpec: (spec) => {
      specs.clear();
      specs.set(prKey(spec.pr.url), spec);
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        // Force open sockets shut before closing. This fixture tears down BEFORE the
        // browser context, so the extension's service worker may still hold a keep-alive
        // connection to this port — and server.close() waits for in-flight sockets to
        // drain, which hangs past the test timeout on a slow CI runner (the "Tearing
        // down bridge exceeded the test timeout" flake). closeAllConnections() drops them
        // so close() returns immediately.
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
