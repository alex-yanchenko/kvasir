import { describe, it, expect } from "vitest";
import {
  bunTarget,
  channelAssetName,
  channelRegistration,
  KVASIR_PERMISSION,
  kvasirShim,
  parseSetupArgs,
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
  const binary = "/home/me/.kvasir/bin/kvasir-channel";
  const entry = { command: binary, args: [] };

  it("adds the kvasir binary entry (empty args) to an absent/non-object config", () => {
    expect(withKvasirServer(undefined, binary)).toEqual({ mcpServers: { kvasir: entry } });
    expect(withKvasirServer("garbage", binary)).toEqual({ mcpServers: { kvasir: entry } });
  });

  it("supports a command + args (the bun-run fallback)", () => {
    expect(withKvasirServer(undefined, "bun", ["run", "/repo/src/channel.ts"])).toEqual({
      mcpServers: { kvasir: { command: "bun", args: ["run", "/repo/src/channel.ts"] } },
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
    expect(channelAssetName("darwin", "arm64")).toBe("kvasir-channel-darwin-arm64");
    expect(channelAssetName("linux", "x64")).toBe("kvasir-channel-linux-x64");
    expect(channelAssetName("win32", "x64")).toBeNull();
  });
});

describe("channelRegistration", () => {
  const binary = "/home/me/.kvasir/bin/kvasir-channel";
  const source = "/repo/packages/mimir/src/channel.ts";

  it("registers the standalone binary for a compiled outcome", () => {
    expect(channelRegistration("compiled", binary, source)).toEqual({
      command: binary,
      args: [],
      label: "(compiled binary)",
    });
  });

  it("registers the standalone binary for a downloaded outcome", () => {
    expect(channelRegistration("downloaded", binary, source)).toEqual({
      command: binary,
      args: [],
      label: "(downloaded prebuilt binary)",
    });
  });

  it("registers a reused prior binary, flagging it as not freshly built", () => {
    expect(channelRegistration("reused", binary, source)).toEqual({
      command: binary,
      args: [],
      label: "(existing binary — re-run after 'pnpm install' to refresh)",
    });
  });

  it("falls back to bun run channel.ts when no binary could be obtained", () => {
    expect(channelRegistration("none", binary, source)).toEqual({
      command: "bun",
      args: ["run", source],
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
  const shim = kvasirShim("/abs/repo");

  it("runs Claude with the channel from the repo dir, freeing the bridge first (no bun)", () => {
    expect(shim).toContain('cd "/abs/repo"');
    expect(shim).toContain("exec claude --dangerously-load-development-channels server:kvasir");
    expect(shim).toContain("iTCP:8799"); // frees the single-owner bridge before launch
    expect(shim).not.toContain("kvasir.ts");
    // `shift` with no positional args returns non-zero; under `set -e` a bare
    // `kvasir` (no subcommand) would abort before launching Claude.
    expect(shim).toContain("shift || true");
  });

  it("routes build to the bun authoring script, guarded on bun being present", () => {
    expect(shim).toContain('exec bun run "/abs/repo/packages/mimir/scripts/buildReview.ts"');
    expect(shim).toContain("kvasir build needs bun");
  });
});
