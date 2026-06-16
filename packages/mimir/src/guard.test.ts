import { describe, it, expect } from "vitest";
import {
  GUARD_HEADER,
  MAX_BODY,
  isForeignWebOrigin,
  isAuthorizedCaller,
  readJsonBody,
  truncate,
  prOrNull,
  type CallerSignals,
} from "./guard";

// A request that should be accepted: from the extension (no/extension origin),
// loopback Host, guard header present, JSON body on POST.
const ok = (over: Partial<CallerSignals> = {}): CallerSignals => ({
  origin: "",
  host: "localhost:8799",
  hasGuardHeader: true,
  method: "GET",
  contentType: "",
  ...over,
});

describe("isForeignWebOrigin", () => {
  it("flags a foreign http(s) origin", () => {
    expect(isForeignWebOrigin("https://evil.example")).toBe(true);
  });
  it("does not flag chrome-extension, empty, or loopback origins", () => {
    expect(isForeignWebOrigin("")).toBe(false);
    expect(isForeignWebOrigin("chrome-extension://abcdef")).toBe(false);
    expect(isForeignWebOrigin("http://localhost:8799")).toBe(false);
    expect(isForeignWebOrigin("http://127.0.0.1:8799")).toBe(false);
  });
  it("honors an explicit allowed origin", () => {
    expect(isForeignWebOrigin("https://example.dev", "https://example.dev")).toBe(false);
    expect(isForeignWebOrigin("https://example.dev", "https://other.dev")).toBe(true);
  });
});

describe("isAuthorizedCaller", () => {
  it("accepts a same-machine call from the extension", () => {
    expect(isAuthorizedCaller(ok())).toBe(true);
    expect(isAuthorizedCaller(ok({ method: "POST", contentType: "application/json" }))).toBe(true);
    expect(isAuthorizedCaller(ok({ origin: "chrome-extension://abc" }))).toBe(true);
  });

  it("rejects a malicious website (foreign Origin) — the CSRF defense", () => {
    expect(isAuthorizedCaller(ok({ origin: "https://evil.example" }))).toBe(false);
  });

  it("rejects a non-loopback Host (DNS-rebinding)", () => {
    expect(isAuthorizedCaller(ok({ host: "evil.example" }))).toBe(false);
    expect(isAuthorizedCaller(ok({ host: "" }))).toBe(false);
  });

  it("rejects a request missing the guard header", () => {
    expect(isAuthorizedCaller(ok({ hasGuardHeader: false }))).toBe(false);
  });

  it("rejects a non-JSON POST", () => {
    expect(isAuthorizedCaller(ok({ method: "POST", contentType: "text/plain" }))).toBe(false);
  });
});

describe("readJsonBody", () => {
  const post = (body: string, headers: Record<string, string> = {}) =>
    new Request("http://localhost:8799/x", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    });

  it("parses a JSON object", async () => {
    expect(await readJsonBody(post(JSON.stringify({ a: 1 })))).toEqual({ a: 1 });
  });
  it("rejects oversized bodies", async () => {
    expect(await readJsonBody(post(JSON.stringify({ a: "x".repeat(MAX_BODY + 10) })))).toBeNull();
  });
  it("rejects malformed JSON, arrays, and primitives", async () => {
    expect(await readJsonBody(post("{not json"))).toBeNull();
    expect(await readJsonBody(post("[1,2,3]"))).toBeNull();
    expect(await readJsonBody(post('"just a string"'))).toBeNull();
  });
});

describe("truncate", () => {
  it("coerces + caps; non-strings become empty", () => {
    expect(truncate("hello", 3)).toBe("hel");
    expect(truncate(42, 10)).toBe("");
    expect(truncate(undefined, 10)).toBe("");
  });
});

describe("prOrNull", () => {
  it("accepts a valid PR url, rejects everything else", () => {
    expect(prOrNull("https://github.com/acme/widget-api/pull/42")).toBe(
      "https://github.com/acme/widget-api/pull/42",
    );
    expect(prOrNull("https://evil.example/a/b/pull/1")).toBeNull();
    expect(prOrNull(12345)).toBeNull();
    expect(prOrNull("x".repeat(400))).toBeNull();
  });
});

it("GUARD_HEADER is the documented header name", () => {
  expect(GUARD_HEADER).toBe("x-kvasir");
});
