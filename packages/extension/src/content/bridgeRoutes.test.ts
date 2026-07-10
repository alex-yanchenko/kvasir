import { KVASIR_PORT } from "@kvasir/runes/port";
import { describe, it, expect } from "vitest";
import manifest from "../../manifest.json";
import { ALLOWED_BRIDGE_PATHS, BRIDGE_BASE, bridgeTarget } from "./bridgeRoutes";

describe("KVASIR_PORT", () => {
  it("matches the manifest's host permission — the one 8799 that cannot import the constant", () => {
    // manifest.json is static JSON, so it holds its own literal; this pin is the
    // only thing tying it to the shared constant. Changing KVASIR_PORT without
    // the manifest would ship an extension that cannot dial the channel.
    expect(manifest.host_permissions).toContain(`http://localhost:${KVASIR_PORT}/*`);
    expect(BRIDGE_BASE).toBe(`http://localhost:${KVASIR_PORT}`);
  });
});

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
