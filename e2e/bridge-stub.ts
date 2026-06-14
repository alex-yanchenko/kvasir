// A stand-in for the Mimir channel server (packages/mimir) on the same port the
// extension's service worker (huginn.ts) hard-codes. The worker holds the
// localhost host_permission and fetches http://localhost:8799 directly, so this
// must be a REAL server — Playwright's page.route only intercepts page-origin
// requests, never the worker's cross-origin fetch. Each test drives it through
// `state`: flip `spec`/`answer`/`suggestions` to script the flow under test.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

const PORT = 8799;

export interface BridgeState {
  // The token the claim endpoint hands back; the worker stores it and echoes it
  // as x-prw-token on later calls. /auth is "paired" exactly when that header is
  // present — mirroring the real bridge holding the token in memory.
  token: string;
  spec: unknown | null;
  answer: string;
  notes: string[];
  suggestions: string[];
  headSha: string;
}

export interface BridgeStub {
  state: BridgeState;
  close: () => Promise<void>;
}

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, {
    "content-type": "application/json",
    // The worker fetches with host_permissions (no CORS), but a preflight costs
    // nothing to satisfy and keeps the stub robust to a stricter fetch path.
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(body));
};

const route = async (req: IncomingMessage, res: ServerResponse, state: BridgeState): Promise<void> => {
  if (req.method === "OPTIONS") {
    json(res, 204, {});
    return;
  }
  const { pathname } = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const paired = typeof req.headers["x-prw-token"] === "string";

  switch (`${req.method} ${pathname}`) {
    case "GET /auth":
      return paired ? json(res, 200, {}) : json(res, 401, { error: "not paired" });
    case "POST /pair":
      return json(res, 200, { requestId: "req-1", code: "PAIR42" });
    case "GET /pair/claim":
      return json(res, 200, { token: state.token });
    case "POST /generate":
      return json(res, 200, {});
    case "GET /walkthrough":
      return state.spec ? json(res, 200, state.spec) : json(res, 404, { error: "no spec" });
    case "GET /head":
      return json(res, 200, { headSha: state.headSha });
    case "POST /ask":
      return json(res, 200, { id: "ask-1" });
    case "GET /poll":
      return json(res, 200, { done: true, text: state.answer, timedOut: false, notes: state.notes });
    case "POST /suggest":
      return json(res, 200, { suggestions: state.suggestions });
    default:
      return json(res, 404, { error: `unhandled ${req.method} ${pathname}` });
  }
};

export async function startBridge(overrides: Partial<BridgeState> = {}): Promise<BridgeStub> {
  const state: BridgeState = {
    token: "e2e-token",
    spec: null,
    answer: "",
    notes: [],
    suggestions: [],
    headSha: "sha-baseline",
    ...overrides,
  };
  const server: Server = createServer((req, res) => {
    void route(req, res, state).catch(() => json(res, 500, { error: "stub crash" }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, resolve);
  });
  return {
    state,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
