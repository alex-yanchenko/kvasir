#!/usr/bin/env bun
/**
 * The `kvasir` CLI. `kvasir` (or `kvasir run`) frees the single-owner :8799 bridge
 * then launches Claude with the channel; `kvasir build <draft.json>` runs the
 * deterministic walkthrough builder. Installed as a one-line shim in ~/.local/bin.
 */
import path from "node:path";

const REPO = path.resolve(import.meta.dir, "../../..");
const [command = "run", ...rest] = Bun.argv.slice(2);

const listeners = (): string[] => {
  const result = Bun.spawnSync(["lsof", "-nP", "-iTCP:8799", "-sTCP:LISTEN", "-t"]);
  return result.stdout
    .toString()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
};

const freeBridge = (): void => {
  if (Bun.which("lsof") === null) return;
  const pids = listeners();
  if (pids.length === 0) return;
  console.error(`kvasir: closing the existing :8799 bridge (pids: ${pids.join(" ")})`);
  Bun.spawnSync(["kill", ...pids]);
  for (let tries = 0; tries < 25 && listeners().length > 0; tries++) Bun.sleepSync(200);
};

if (command === "build") {
  const result = Bun.spawnSync(
    ["bun", "run", path.join(REPO, "packages/mimir/scripts/buildReview.ts"), ...rest],
    {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  process.exit(result.exitCode ?? 1);
} else if (command === "run") {
  freeBridge();
  const result = Bun.spawnSync(
    ["claude", "--dangerously-load-development-channels", "server:kvasir", ...rest],
    {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      cwd: REPO,
    },
  );
  process.exit(result.exitCode ?? 1);
} else {
  console.error("usage: kvasir [run] | kvasir build <draft.json>");
  process.exit(1);
}
