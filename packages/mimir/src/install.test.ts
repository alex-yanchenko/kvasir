import { describe, it, expect } from "vitest";
import {
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
  const channel = "/repo/packages/mimir/src/channel.ts";
  const entry = { command: "bun", args: ["run", channel] };

  it("adds the kvasir entry to an absent/non-object config", () => {
    expect(withKvasirServer(undefined, channel)).toEqual({ mcpServers: { kvasir: entry } });
    expect(withKvasirServer("garbage", channel)).toEqual({ mcpServers: { kvasir: entry } });
  });

  it("preserves other servers and overrides a stale kvasir", () => {
    const prev = { mcpServers: { "example-watcher": { command: "x" }, kvasir: { command: "old" } } };
    expect(withKvasirServer(prev, channel)).toEqual({
      mcpServers: { "example-watcher": { command: "x" }, kvasir: entry },
    });
  });

  it("does not mutate the input", () => {
    const prev = { mcpServers: { a: { command: "x" } } };
    withKvasirServer(prev, channel);
    expect(prev).toEqual({ mcpServers: { a: { command: "x" } } });
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
  it("hands off to the in-repo bun CLI, forwarding args", () => {
    expect(kvasirShim("/abs/repo")).toBe(
      '#!/usr/bin/env bash\nexec bun run "/abs/repo/packages/mimir/scripts/kvasir.ts" "$@"\n',
    );
  });
});
