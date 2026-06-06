/**
 * Request gate for the localhost bridge. None of these checks rely on a secret —
 * they lean on signals the browser sets that a web page cannot forge, so the
 * header name (and this source) being public doesn't matter. See README "Security".
 *
 * The logic is split into a pure core (isAuthorizedCaller, over plain values) and
 * thin Request-reading wrappers, so the security rules are easy to unit-test.
 */
import { PR_URL_RE } from "@prw/shared";

/** Custom header the extension's background worker sends on every request. A page
 *  can't set a custom header on a "simple" cross-origin request, and any request
 *  that does set it is forced through a CORS preflight we don't grant. */
export const GUARD_HEADER = "x-pr-walkthrough";

/** 256 KB — these payloads are small; cap to avoid abuse. */
export const MAX_BODY = 256 * 1024;

const isLoopbackHost = (host: string): boolean => /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);

/** A foreign web origin is an http(s) origin that's neither the allowed one nor
 *  loopback. chrome-extension:// origins and an absent origin are NOT foreign — the
 *  extension's background worker sends one of those, so it passes. */
export function isForeignWebOrigin(origin: string, allowedOrigin?: string): boolean {
  if (!/^https?:\/\//i.test(origin)) return false;
  if (origin === allowedOrigin) return false;
  return !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
}

export interface CallerSignals {
  origin: string;
  host: string;
  hasGuardHeader: boolean;
  method: string;
  contentType: string;
}

/** Pure core of the gate: reject anything that isn't a same-machine call from our
 *  own extension. Cross-origin web page (foreign Origin), DNS-rebinding (non-loopback
 *  Host), simple-request CSRF (missing guard header), and non-JSON POST are all refused. */
export function isAuthorizedCaller(s: CallerSignals, allowedOrigin?: string): boolean {
  if (isForeignWebOrigin(s.origin, allowedOrigin)) return false;
  if (!isLoopbackHost(s.host)) return false;
  if (!s.hasGuardHeader) return false;
  if (s.method === "POST" && !s.contentType.includes("application/json")) return false;
  return true;
}

/** Request-reading wrapper around isAuthorizedCaller. */
export function authorizedLocalCaller(req: Request): boolean {
  return isAuthorizedCaller(
    {
      origin: req.headers.get("origin") ?? "",
      host: req.headers.get("host") ?? "",
      hasGuardHeader: req.headers.get(GUARD_HEADER) !== null,
      method: req.method,
      contentType: req.headers.get("content-type") ?? "",
    },
    process.env.PR_WALKTHROUGH_ORIGIN,
  );
}

/** No wildcard, and no github.com by default: the extension talks to us through its
 *  privileged background worker (not subject to CORS), so nothing legitimate needs a
 *  cross-origin grant. Only an explicit env override is reflected. */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const headers: Record<string, string> = {
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type," + GUARD_HEADER,
    vary: "origin",
  };
  if (origin && origin === process.env.PR_WALKTHROUGH_ORIGIN) headers["access-control-allow-origin"] = origin;
  return headers;
}

/** Parse a JSON object body with a hard size limit; null on anything malformed/oversized. */
export async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return null;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) return null;
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Coerce to a string and cap its length (cost + abuse control; never trust the client). */
export const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

/** Accept a value only if it's a well-formed GitHub PR URL — so nothing arbitrary
 *  lands in a `gh` path or a session prompt. */
export const prOrNull = (v: unknown): string | null => {
  const s = str(v, 300);
  return PR_URL_RE.test(s) ? s : null;
};
