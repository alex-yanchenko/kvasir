import { describe, it, expect } from "vitest";
import { ALLOWED_BRIDGE_PATHS, BRIDGE_BASE, bridgeTarget } from "./bridgeRoutes";

describe("bridgeTarget", () => {
  it("resolves an allowlisted path (with a query) to a same-origin bridge URL", () => {
    const url = bridgeTarget("/review?id=abc");
    expect(url?.origin).toBe(BRIDGE_BASE);
    expect(url?.pathname).toBe("/review");
    expect(url?.href).toBe(`${BRIDGE_BASE}/review?id=abc`);
  });

  it("rejects a path that is not on the allowlist", () => {
    expect(bridgeTarget("/etc/passwd")).toBeNull();
    expect(bridgeTarget("/walkthrough/../secret")).toBeNull();
  });

  it("rejects a protocol-relative or absolute path that escapes the bridge origin", () => {
    expect(bridgeTarget("//evil.com/health")).toBeNull();
    expect(bridgeTarget("http://evil.com/health")).toBeNull();
    expect(bridgeTarget("//localhost:8799@evil.com/health")).toBeNull();
  });

  it("rejects a non-127-loopback host even on an allowlisted pathname", () => {
    expect(bridgeTarget("https://localhost:8799/health")).toBeNull(); // wrong scheme/origin
  });

  it("exposes the routes the extension actually calls", () => {
    for (const path of ["/walkthrough", "/ask", "/history", "/entries", "/pair/claim"]) {
      expect(ALLOWED_BRIDGE_PATHS.has(path)).toBe(true);
    }
  });
});
