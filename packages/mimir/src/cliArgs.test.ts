import { describe, it, expect } from "vitest";
import { CLI_USAGE, type CliCommand, parseCli } from "./cliArgs";

describe("parseCli", () => {
  it("routes a bare invocation to run with no forwarded args", () => {
    expect(parseCli([])).toEqual({ kind: "run", forward: [] } satisfies CliCommand);
  });

  it("forwards the tail after `run` through to Claude", () => {
    expect(parseCli(["run", "--model", "opus", "-p"])).toEqual({
      kind: "run",
      forward: ["--model", "opus", "-p"],
    } satisfies CliCommand);
  });

  it("routes the channel subcommand", () => {
    expect(parseCli(["channel"])).toEqual({ kind: "channel" } satisfies CliCommand);
  });

  it("takes the first non-flag argument as the build draft", () => {
    expect(parseCli(["build", "/tmp/draft.json"])).toEqual({
      kind: "build",
      draft: "/tmp/draft.json",
    } satisfies CliCommand);
  });

  it("leaves the build draft undefined when only flags follow", () => {
    expect(parseCli(["build", "--help"])).toEqual({
      kind: "build",
      draft: undefined,
    } satisfies CliCommand);
  });

  it("skips leading flags to find the build draft", () => {
    expect(parseCli(["build", "--verbose", "/tmp/draft.json"])).toEqual({
      kind: "build",
      draft: "/tmp/draft.json",
    } satisfies CliCommand);
  });

  it("recognizes --version and -v only as the leading token", () => {
    expect(parseCli(["--version"])).toEqual({ kind: "version" } satisfies CliCommand);
    expect(parseCli(["-v"])).toEqual({ kind: "version" } satisfies CliCommand);
  });

  it("recognizes --help and -h", () => {
    expect(parseCli(["--help"])).toEqual({ kind: "help" } satisfies CliCommand);
    expect(parseCli(["-h"])).toEqual({ kind: "help" } satisfies CliCommand);
  });

  it("does NOT treat a version flag after run as version — run forwards it", () => {
    expect(parseCli(["run", "--version"])).toEqual({
      kind: "run",
      forward: ["--version"],
    } satisfies CliCommand);
  });

  it("reports an unrecognized leading token rather than launching", () => {
    expect(parseCli(["buld"])).toEqual({ kind: "unknown", token: "buld" } satisfies CliCommand);
  });
});

describe("CLI_USAGE", () => {
  it("documents every user-facing subcommand", () => {
    for (const line of [
      "kvasir run",
      "kvasir build",
      "kvasir channel",
      "kvasir --version",
      "kvasir --help",
    ]) {
      expect(CLI_USAGE).toContain(line);
    }
  });
});
