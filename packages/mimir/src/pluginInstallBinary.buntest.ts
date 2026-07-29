// Runs under `bun test` (spawns real bash + a fake `gh` on PATH). Proves the two guarantees
// the SessionStart hook must hold: it installs the binary only when the build-provenance
// attestation verifies (fail-closed), and it always exits 0 so it can never block a session.
// A stubbed `gh` stands in for the network: `release download` writes a dummy asset,
// `attestation verify` exits with a controllable code.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

const SCRIPT = path.resolve(import.meta.dir, "../../../plugin/scripts/install-binary.sh");
const PLUGIN_ROOT = path.resolve(import.meta.dir, "../../../plugin"); // supplies .claude-plugin/plugin.json

let sandbox: string;
let fakeBin: string;

// A `gh` stub on PATH: `release download` materializes the --output asset; `attestation
// verify` exits `attestExit`; anything else is a no-op success.
function writeFakeGh(attestExit: number): void {
  const gh = path.join(fakeBin, "gh");
  writeFileSync(
    gh,
    `#!/usr/bin/env bash
if [ "$1 $2" = "release download" ]; then
  out=""; while [ $# -gt 0 ]; do [ "$1" = "--output" ] && out="$2"; shift; done
  [ -n "$out" ] && printf 'dummy-binary' > "$out"
  exit 0
fi
if [ "$1 $2" = "attestation verify" ]; then exit ${attestExit}; fi
exit 0
`,
  );
  chmodSync(gh, 0o755);
}

const run = (): { exitCode: number | null } =>
  Bun.spawnSync(["bash", SCRIPT], {
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      HOME: sandbox,
      CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
      CLAUDE_PLUGIN_DATA: path.join(sandbox, "data"),
      KVASIR_TEST_UNAME: "Darwin arm64",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

const installedBinary = (): boolean => existsSync(path.join(sandbox, ".local", "bin", "kvasir"));

beforeEach(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), "kvasir-hook-"));
  fakeBin = path.join(sandbox, "fake-bin");
  mkdirSync(fakeBin, { recursive: true });
});
afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("install-binary.sh (real bash, stubbed gh)", () => {
  it("installs the binary onto ~/.local/bin when the attestation verifies", () => {
    writeFakeGh(0);
    expect(run().exitCode).toBe(0);
    expect(installedBinary()).toBe(true);
  });

  it("refuses to install when the attestation does not verify, and still exits 0", () => {
    writeFakeGh(1);
    expect(run().exitCode).toBe(0); // never blocks the session
    expect(installedBinary()).toBe(false); // fail-closed: the unverified asset is not installed
  });
});
