// The allowlist + resolver for the localhost bridge proxy. Extracted from huginn
// (the background worker) as a pure module so the security-load-bearing gate — the
// origin check and the route allowlist — is unit-testable without a service-worker
// harness. The worker's confused-deputy risk is that an in-page script could borrow
// its pairing token to hit an unintended route or, via a protocol-relative/userinfo
// path, an off-origin host; bridgeTarget() rejects both.
import { KVASIR_PORT } from "@kvasir/runes/port";

export const BRIDGE_BASE = `http://localhost:${KVASIR_PORT}`;

/** The bridge routes the worker is allowed to proxy to. */
export const ALLOWED_BRIDGE_PATHS = new Set([
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

/** Resolve a request path to the bridge URL it should hit, or null if it doesn't
 * land on the localhost bridge origin or isn't an allowlisted route. A
 * protocol-relative ("//host"), absolute ("http://evil"), or userinfo
 * ("//localhost:8799@evil") path resolves to a different origin and is rejected. */
export const bridgeTarget = (path: string): URL | null => {
  try {
    const url = new URL(path, BRIDGE_BASE);
    return url.origin === BRIDGE_BASE && ALLOWED_BRIDGE_PATHS.has(url.pathname) ? url : null;
  } catch {
    return null; // not a resolvable path
  }
};
