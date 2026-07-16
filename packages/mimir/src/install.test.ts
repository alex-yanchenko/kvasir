import { describe, it, expect } from "vitest";
import {
  attestationVerifyArgs,
  bunTarget,
  channelAssetName,
  channelRegistration,
  KVASIR_PERMISSION,
  kvasirShim,
  parseSetupArgs,
  RELEASE_REPO,
  SETUP_USAGE,
  withKvasirPermission,
  withKvasirServer,
} from "./install";

describe("parseSetupArgs", () => {
  it("defaults everything off and collects unknown args", () => {
    expect(parseSetupArgs([])).toEqual({ copy: false, allowPush: false, help: false, unknown: [] });
    expect(parseSetupArgs(["--nope", "x"])).toEqual({
      copy: false,
      allowPush: false,
      help: false,
      unknown: ["--nope", "x"],
    });
  });

  it("parses the known flags in any order", () => {
    expect(parseSetupArgs(["--allow-push", "--copy"])).toEqual({
      copy: true,
      allowPush: true,
      help: false,
      unknown: [],
    });
    expect(parseSetupArgs(["-h"])).toEqual({ copy: false, allowPush: false, help: true, unknown: [] });
    expect(parseSetupArgs(["--help"])).toEqual({ copy: false, allowPush: false, help: true, unknown: [] });
  });
});

describe("SETUP_USAGE", () => {
  it("documents the usage line and every flag", () => {
    expect(SETUP_USAGE).toContain("Usage:");
    expect(SETUP_USAGE).toContain("--copy");
    expect(SETUP_USAGE).toContain("--allow-push");
    expect(SETUP_USAGE).toContain("--help");
  });
});

describe("withKvasirServer", () => {
  const binary = "/home/me/.local/bin/kvasir";
  const entry = { command: binary, args: [] };

  it("adds the kvasir binary entry (empty args) to an absent/non-object config", () => {
    expect(withKvasirServer(undefined, binary)).toEqual({ mcpServers: { kvasir: entry } });
    expect(withKvasirServer("garbage", binary)).toEqual({ mcpServers: { kvasir: entry } });
  });

  it("registers the unified binary as the channel via args:['channel']", () => {
    expect(withKvasirServer(undefined, binary, ["channel"])).toEqual({
      mcpServers: { kvasir: { command: binary, args: ["channel"] } },
    });
  });

  it("supports a command + args (the bun-run fallback)", () => {
    expect(withKvasirServer(undefined, "bun", ["run", "/repo/src/main.ts", "channel"])).toEqual({
      mcpServers: { kvasir: { command: "bun", args: ["run", "/repo/src/main.ts", "channel"] } },
    });
  });

  it("preserves other servers and overrides a stale kvasir", () => {
    const prev = {
      mcpServers: { "other-server": { command: "x" }, kvasir: { command: "old", args: ["a"] } },
    };
    expect(withKvasirServer(prev, binary)).toEqual({
      mcpServers: { "other-server": { command: "x" }, kvasir: entry },
    });
  });

  it("does not mutate the input", () => {
    const prev = { mcpServers: { a: { command: "x" } } };
    withKvasirServer(prev, binary);
    expect(prev).toEqual({ mcpServers: { a: { command: "x" } } });
  });
});

describe("bunTarget / channelAssetName", () => {
  it("maps supported platforms to a bun --compile target", () => {
    expect(bunTarget("darwin", "arm64")).toBe("bun-darwin-arm64");
    expect(bunTarget("darwin", "x64")).toBe("bun-darwin-x64");
    expect(bunTarget("linux", "x64")).toBe("bun-linux-x64");
    expect(bunTarget("linux", "arm64")).toBe("bun-linux-arm64");
  });

  it("returns null for an unsupported platform/arch", () => {
    expect(bunTarget("win32", "x64")).toBeNull();
    expect(bunTarget("darwin", "ia32")).toBeNull();
  });

  it("derives the release asset name, null when unsupported", () => {
    expect(channelAssetName("darwin", "arm64")).toBe("kvasir-darwin-arm64");
    expect(channelAssetName("linux", "x64")).toBe("kvasir-linux-x64");
    expect(channelAssetName("win32", "x64")).toBeNull();
  });
});

describe("attestationVerifyArgs", () => {
  it("builds the gh attestation-verify argv against the release repo by default", () => {
    expect(attestationVerifyArgs("/tmp/kvasir-linux-x64")).toEqual([
      "attestation",
      "verify",
      "/tmp/kvasir-linux-x64",
      "--repo",
      RELEASE_REPO,
    ]);
  });

  it("accepts an explicit repo (fork installs verify against their own releases)", () => {
    expect(attestationVerifyArgs("/tmp/extension-dist.tgz", "octocat/kvasir")).toEqual([
      "attestation",
      "verify",
      "/tmp/extension-dist.tgz",
      "--repo",
      "octocat/kvasir",
    ]);
  });
});

describe("channelRegistration", () => {
  const binary = "/home/me/.local/bin/kvasir";
  const source = "/repo/packages/mimir/src/main.ts";

  it("registers the unified binary as `kvasir channel` for a compiled outcome", () => {
    expect(channelRegistration("compiled", binary, source)).toEqual({
      command: binary,
      args: ["channel"],
      label: "(compiled binary)",
    });
  });

  it("registers the unified binary as `kvasir channel` for a downloaded outcome", () => {
    expect(channelRegistration("downloaded", binary, source)).toEqual({
      command: binary,
      args: ["channel"],
      label: "(downloaded prebuilt binary)",
    });
  });

  it("registers a reused prior binary, flagging it as not freshly built", () => {
    expect(channelRegistration("reused", binary, source)).toEqual({
      command: binary,
      args: ["channel"],
      label: "(existing binary — re-run after 'pnpm install' to refresh)",
    });
  });

  it("falls back to bun run main.ts channel when no binary could be obtained", () => {
    expect(channelRegistration("none", binary, source)).toEqual({
      command: "bun",
      args: ["run", source, "channel"],
      label: "(bun run — install bun + run 'pnpm install', or gh, for a standalone binary)",
    });
  });
});

describe("withKvasirPermission", () => {
  it("adds the permission to an absent/non-object config", () => {
    expect(withKvasirPermission(undefined)).toEqual({
      config: { permissions: { allow: [KVASIR_PERMISSION] } },
      changed: true,
    });
  });

  it("is idempotent when already present", () => {
    const prev = { permissions: { allow: [KVASIR_PERMISSION] } };
    expect(withKvasirPermission(prev)).toEqual({ config: prev, changed: false });
  });

  it("preserves other allows and config keys", () => {
    const prev = { model: "opus", permissions: { allow: ["Bash(ls:*)"] } };
    expect(withKvasirPermission(prev)).toEqual({
      config: { model: "opus", permissions: { allow: ["Bash(ls:*)", KVASIR_PERMISSION] } },
      changed: true,
    });
  });
});

describe("kvasirShim", () => {
  it("forwards to a standalone binary", () => {
    expect(kvasirShim("/home/me/.kvasir/bin/kvasir")).toBe(
      '#!/usr/bin/env bash\nexec "/home/me/.kvasir/bin/kvasir" "$@"\n',
    );
  });

  it("forwards to the source entry via bun run when there is no binary", () => {
    expect(kvasirShim("bun", ["run", "/repo/packages/mimir/src/main.ts"])).toBe(
      '#!/usr/bin/env bash\nexec "bun" "run" "/repo/packages/mimir/src/main.ts" "$@"\n',
    );
  });
});
