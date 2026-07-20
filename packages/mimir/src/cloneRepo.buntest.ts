// Runs under `bun test` (NOT vitest) — Bun.spawn is Bun-only. Real-git proof of the
// central adoption safety claim: `git clone --local` of a weaponized source repo (whose
// .git/config an attacker fully controls) executes NONE of the planted exec vectors and
// leaves them out of the fresh dest config, so a later checkout runs nothing the attacker
// planted. The pure argv/env is unit-tested in cloneRepo.test.ts; this exercises it
// against real git, mirroring contextWorktree.buntest.ts's hook/symlink proofs.
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { localCloneCommand } from "./cloneRepo";

function git(cwd: string, args: string[]): void {
  const proc = Bun.spawnSync(["git", "-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) throw new Error(`fixture git ${args.join(" ")}: ${proc.stderr.toString()}`); // allow-bare-error: test-fixture setup assertion, never caught
}

/** Run one localCloneCommand step under its own hardening flags + env; returns exit code. */
async function run(step: { cmd: readonly string[]; env: Record<string, string> }): Promise<number> {
  const proc = Bun.spawn([...step.cmd], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...step.env },
  });
  await new Response(proc.stdout).text();
  await new Response(proc.stderr).text();
  return proc.exited;
}

let sandbox: string;
let source: string;
let destination: string;
let sentinel: string;

beforeEach(async () => {
  sandbox = mkdtempSync(path.join(tmpdir(), "kvasir-adopt-"));
  source = path.join(sandbox, "source");
  destination = path.join(sandbox, "clones", "acme", "widget");
  sentinel = path.join(sandbox, "PWNED");

  git(sandbox, ["init", "-b", "main", source]);
  await Bun.write(path.join(source, "file.txt"), "hello\n");
  await Bun.write(path.join(source, ".gitattributes"), "file.txt filter=evil\n");
  git(source, ["add", "."]);
  git(source, ["commit", "-m", "init"]);

  // Weaponize the SOURCE .git/config: every exec vector an attacker-authored config can
  // carry, each pointing at a payload script that touches the sentinel when run.
  const pwn = path.join(sandbox, "pwn.sh");
  await Bun.write(pwn, `#!/bin/sh\necho x >> "${sentinel}"\n`);
  chmodSync(pwn, 0o755);
  git(source, ["config", "core.fsmonitor", pwn]);
  git(source, ["config", "filter.evil.smudge", pwn]);
  git(source, ["config", "filter.evil.process", pwn]);
  git(source, ["config", "filter.evil.required", "true"]);
  await Bun.write(path.join(source, ".git", "hooks", "post-checkout"), `#!/bin/sh\ntouch "${sentinel}"\n`);
  chmodSync(path.join(source, ".git", "hooks", "post-checkout"), 0o755);
});
afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("localCloneCommand adoption (real git)", () => {
  it("CONTROL: the planted payloads actually fire in the source (proves the test isn't vacuous)", () => {
    // fsmonitor / the process filter run on a plain `git status` in the source repo.
    Bun.spawnSync(["git", "-C", source, "status"], { stdout: "pipe", stderr: "pipe" });
    expect(existsSync(sentinel)).toBe(true);
  });

  it("clones the weaponized source WITHOUT running any planted payload, and strips its exec config", async () => {
    for (const step of localCloneCommand("acme", "widget", source, destination)) {
      expect(await run(step)).toBe(0);
    }
    expect(existsSync(sentinel)).toBe(false); // nothing the attacker planted executed
    expect(existsSync(destination)).toBe(true);
    const destinationConfig = readFileSync(path.join(destination, ".git", "config"), "utf8");
    expect(destinationConfig).not.toContain("fsmonitor");
    expect(destinationConfig).not.toContain("filter");
    // origin is reset to the canonical github URL, never the local source path
    const origin = Bun.spawnSync(["git", "-C", destination, "remote", "get-url", "origin"])
      .stdout.toString()
      .trim();
    expect(origin).toBe("https://github.com/acme/widget.git");
    // the checked-out file is the raw blob — the required `evil` filter neither ran nor
    // hard-failed, because the fresh dest config defines no such driver
    expect(readFileSync(path.join(destination, "file.txt"), "utf8")).toBe("hello\n");
  });
});
