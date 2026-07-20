import { describe, it, expect } from "vitest";
import { GIT_HARDENING, GIT_TERMINAL_PROMPT_OFF, gitHardeningFlags } from "./gitHardening";

describe("gitHardeningFlags", () => {
  it("returns the four -c overrides that neutralize the tree-content exec vectors", () => {
    expect(gitHardeningFlags()).toEqual([
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "safe.bareRepository=explicit",
      "-c",
      "core.symlinks=false",
    ]);
  });

  it("returns a fresh mutable copy each call (mutating one must not affect GIT_HARDENING or the next)", () => {
    const a = gitHardeningFlags();
    a.push("-c", "tampered=1");
    expect(gitHardeningFlags()).toEqual([...GIT_HARDENING]);
  });

  it("exposes the headless terminal-prompt env pair", () => {
    expect(GIT_TERMINAL_PROMPT_OFF).toEqual({ GIT_TERMINAL_PROMPT: "0" });
  });
});
