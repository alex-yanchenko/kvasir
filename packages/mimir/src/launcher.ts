// `kvasir run` — the Option C launcher. Frees the single-owner :8799 bridge,
// writes a self-referencing MCP config under ~/.kvasir, and execs Claude with
// that config from the CURRENT directory. No cd, no per-project registration,
// no repo path baked into the binary: run it once from anywhere and every Claude
// session pushes walkthroughs to the one bridge (invariant 2). The pure argv/
// config builders are separated from the IO so the launch contract is testable.

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
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
 * the channel through install.sh, not through this launcher. */
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

/** Kill any process still LISTENing on the bridge port so the channel Claude is
 * about to spawn can bind it — the bridge is single-owner by design (one channel
 * serves every repo). Best-effort: skipped where `lsof` is absent, and a pid that
 * exits between the scan and the kill is ignored. */
async function freeBridgePort(port: number): Promise<void> {
  if (Bun.which("lsof") === null) return;
  const listeners = (): string =>
    Bun.spawnSync(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"])
      .stdout.toString()
      .trim();
  const pids = listeners();
  if (pids === "") return;
  console.error(`[kvasir] closing the existing :${port} bridge (${pids.replaceAll("\n", " ")})`);
  for (const pid of pids.split("\n")) {
    try {
      process.kill(Number(pid));
    } catch {
      // Already gone between the scan and this kill — nothing to free.
    }
  }
  for (let attempt = 0; attempt < 25 && listeners() !== ""; attempt++) {
    await Bun.sleep(200);
  }
}

/** Launch a Claude session with the kvasir channel loaded. Propagates Claude's
 * exit code so `kvasir run` exits as Claude did. */
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
  process.exitCode = child.exitCode ?? 0;
}
