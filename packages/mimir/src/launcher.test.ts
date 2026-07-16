import { constants } from "node:os";
import { describe, it, expect } from "vitest";
import {
  exitCodeFrom,
  launcherArgv,
  launcherMcpConfig,
  launcherMcpConfigPath,
  parseListenerPids,
} from "./launcher";

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

describe("parseListenerPids", () => {
  it("parses one positive PID per line", () => {
    expect(parseListenerPids("123\n456")).toEqual([123, 456]);
  });

  it("drops blank lines and surrounding whitespace", () => {
    expect(parseListenerPids("123\n\n  456  \n")).toEqual([123, 456]);
  });

  it("returns [] for empty output", () => {
    expect(parseListenerPids("")).toEqual([]);
  });

  it("drops non-numeric lines", () => {
    expect(parseListenerPids("abc\n12")).toEqual([12]);
  });

  it("excludes 0 — process.kill(0) would signal the whole process group", () => {
    expect(parseListenerPids("0\n5")).toEqual([5]);
  });
});

describe("exitCodeFrom", () => {
  it("passes a normal exit code straight through", () => {
    expect(exitCodeFrom(0, null)).toBe(0);
    expect(exitCodeFrom(2, null)).toBe(2);
  });

  it("maps a signal death to 128 + signum (the shell convention)", () => {
    expect(exitCodeFrom(null, "SIGINT")).toBe(128 + constants.signals.SIGINT);
    expect(exitCodeFrom(null, "SIGKILL")).toBe(128 + constants.signals.SIGKILL);
  });

  it("prefers a real exit code over a signal code when both are present", () => {
    expect(exitCodeFrom(0, "SIGINT")).toBe(0);
  });

  it("reports a generic failure (1) when neither exit nor signal is known", () => {
    expect(exitCodeFrom(null, null)).toBe(1);
  });
});
