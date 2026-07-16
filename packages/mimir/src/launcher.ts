// `kvasir run` — the Option C launcher. Frees the single-owner :8799 bridge,
// writes a self-referencing MCP config under ~/.kvasir, and execs Claude with
// that config from the CURRENT directory. No cd, no per-project registration,
// no repo path baked into the binary: run it once from anywhere and every Claude
// session pushes walkthroughs to the one bridge (invariant 2). The pure argv/
// config/exit-code/pid builders are separated from the IO so the launch contract
// is testable.

import { mkdirSync, writeFileSync } from "node:fs";
import { constants, homedir } from "node:os";
import path from "node:path";
import { KVASIR_PORT } from "@kvasir/runes/port";
import { withKvasirServer } from "./install";

/** Where `kvasir run` writes the config it hands Claude via --mcp-config. Under
 * ~/.kvasir (server-owned) so no repo directory is touched. */
export function launcherMcpConfigPath(home: string = homedir()): string {
  return path.join(home, ".kvasir", "mcp.json");
}

/** The config `kvasir run` writes: a single `kvasir` server that re-invokes THIS
 * binary as the channel (`<binary> channel`). Claude loads it via --mcp-config
 * and --dangerously-load-development-channels promotes it to a channel — verified
 * (2026-07-16) to resolve and spawn a server supplied by --mcp-config, not only
 * one auto-discovered from a CWD .mcp.json. `execPath` is the compiled binary's
 * own path (process.execPath); under `bun run` in a dev clone it is the bun
 * runtime instead, so `kvasir run` is a shipped-binary path — dev clones register
 * the channel through install.sh, not through this launcher.
 *
 * Precedence note: a `kvasir` server supplied here via --mcp-config WINS over a
 * same-named server in the CWD's own .mcp.json (Claude keeps one entry per name,
 * CLI source first). So running the installed `kvasir run` from the kvasir repo
 * shadows a repo-local `kvasir` dev entry — to exercise unbuilt channel source,
 * launch `claude` directly (see packages/mimir/README.md), not `kvasir run`. */
export function launcherMcpConfig(execPath: string): Record<string, unknown> {
  return withKvasirServer({}, execPath, ["channel"]);
}

/** The `claude` argv `kvasir run` execs: load the self-written config, promote the
 * kvasir server to a development channel, then forward the user's own flags (e.g.
 * `kvasir run --model opus` → `--model opus` reaches Claude untouched). */
export function launcherArgv(mcpConfigPath: string, forward: readonly string[]): string[] {
  return [
    "--mcp-config",
    mcpConfigPath,
    "--dangerously-load-development-channels",
    "server:kvasir",
    ...forward,
  ];
}

/** Parse `lsof -t` output (one PID per line) into positive-integer PIDs, dropping
 * blank lines. Guards the kill below: `Number("")` is 0, not NaN, and
 * `process.kill(0)` signals the caller's WHOLE process group (the launcher + its
 * parent shell) — never the intent. `> 0` also excludes it. */
export function parseListenerPids(raw: string): number[] {
  return raw
    .split("\n")
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

/** Translate a finished child's status into a process exit code, mirroring the
 * shell's `128 + signum` convention for a signal death. Bun reports
 * `exitCode === null` exactly when the child was killed by a signal (the read
 * happens after `await child.exited`, so it has definitively exited) and puts the
 * signal name in `signalCode`; returning `?? 0` there would report a Ctrl-C'd or
 * crashed Claude as success, which the old `exec claude` shim never did. */
export function exitCodeFrom(exitCode: number | null, signalCode: NodeJS.Signals | null): number {
  if (exitCode !== null) return exitCode;
  if (signalCode === null) return 1;
  return 128 + (constants.signals[signalCode] ?? 0);
}

/** Kill any process still LISTENing on the bridge port so the channel Claude is
 * about to spawn can bind it — the bridge is single-owner by design (one channel
 * serves every repo). Best-effort: skipped where `lsof` is absent, and a pid that
 * exits between the scan and the kill is ignored. */
async function freeBridgePort(port: number): Promise<void> {
  if (Bun.which("lsof") === null) return;
  const listenerPids = (): number[] =>
    parseListenerPids(
      Bun.spawnSync(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]).stdout.toString(),
    );
  const pids = listenerPids();
  if (pids.length === 0) return;
  console.error(`[kvasir] closing the existing :${port} bridge (${pids.join(" ")})`);
  for (const pid of pids) {
    try {
      process.kill(pid);
    } catch {
      // Already gone between the scan and this kill — nothing to free.
    }
  }
  for (let attempt = 0; attempt < 25 && listenerPids().length > 0; attempt++) {
    await Bun.sleep(200);
  }
}

/** Launch a Claude session with the kvasir channel loaded. Propagates Claude's
 * exit code (including signal deaths as 128+signum) so `kvasir run` exits as
 * Claude did. */
export async function runLauncher(forward: readonly string[]): Promise<void> {
  await freeBridgePort(KVASIR_PORT);
  const configPath = launcherMcpConfigPath();
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(launcherMcpConfig(process.execPath), null, 2)}\n`);
  const child = Bun.spawn(["claude", ...launcherArgv(configPath, forward)], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  await child.exited;
  process.exitCode = exitCodeFrom(child.exitCode, child.signalCode);
}
