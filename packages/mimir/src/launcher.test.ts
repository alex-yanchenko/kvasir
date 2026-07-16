import { describe, it, expect } from "vitest";
import { launcherArgv, launcherMcpConfig, launcherMcpConfigPath } from "./launcher";

describe("launcherMcpConfigPath", () => {
  it("writes the config under ~/.kvasir, never a repo directory", () => {
    expect(launcherMcpConfigPath("/home/me")).toBe("/home/me/.kvasir/mcp.json");
  });
});

describe("launcherMcpConfig", () => {
  it("registers the running binary as the channel via `<binary> channel`", () => {
    expect(launcherMcpConfig("/home/me/.kvasir/bin/kvasir")).toEqual({
      mcpServers: { kvasir: { command: "/home/me/.kvasir/bin/kvasir", args: ["channel"] } },
    });
  });
});

describe("launcherArgv", () => {
  it("loads the written config and promotes kvasir to a development channel", () => {
    expect(launcherArgv("/home/me/.kvasir/mcp.json", [])).toEqual([
      "--mcp-config",
      "/home/me/.kvasir/mcp.json",
      "--dangerously-load-development-channels",
      "server:kvasir",
    ]);
  });

  it("forwards the user's own flags after the channel promotion", () => {
    expect(launcherArgv("/cfg.json", ["--model", "opus"])).toEqual([
      "--mcp-config",
      "/cfg.json",
      "--dangerously-load-development-channels",
      "server:kvasir",
      "--model",
      "opus",
    ]);
  });
});
