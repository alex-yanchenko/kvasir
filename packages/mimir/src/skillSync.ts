// Keep the installed `/kvasir` skill in step with the binary's embedded copy.
// Two modes: `install` explicitly copies the skill in (create or overwrite);
// `sync` (run by `kvasir skill sync` and on every channel start) is UPDATE-ONLY —
// it refreshes an already-installed skill when the embedded content has drifted
// but NEVER creates it uninvited (invariant 3). Failure-safe: an unwritable home
// returns a result, never throws, so it can't break the channel or the CLI.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** The skill's directory name under `~/.claude/skills`. */
export const SKILL_NAME = "kvasir";
/** Set `KVASIR_SKILL_SYNC=0` to opt out of the update-only sync (channel-start and
 * `skill sync`). Never gates an explicit `skill install`. */
const SKILL_SYNC_OPT_OUT = "KVASIR_SKILL_SYNC";

/** Whether an update-only sync should write. `absent` = not installed (leave it —
 * sync never creates); `current` = installed and identical; `write` = installed
 * and drifted. `installed` is the on-disk SKILL.md text, or null when absent. */
type SyncDecision = "write" | "absent" | "current";

export function syncDecision(installed: string | null, embedded: string): SyncDecision {
  if (installed === null) return "absent";
  if (installed === embedded) return "current";
  return "write";
}

export interface SkillSyncResult {
  action: "installed" | "updated" | "up-to-date" | "absent" | "opted-out" | "failed";
  /** One-line summary for a single stderr line. */
  message: string;
}

function readTextOrNull(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    // ENOENT (not installed) or unreadable — either way, treat as absent so sync
    // leaves it alone rather than clobbering something it can't read.
    return null;
  }
}

/** Install or update the embedded skill. `install` always writes; `sync` writes
 * only an installed-and-drifted skill (and honors the opt-out env). Never throws. */
export function runSkillSync(options: {
  /** The `~/.claude/skills` directory (injected so tests use a temp dir). */
  skillsDir: string;
  /** The binary's embedded SKILL.md content. */
  embedded: string;
  mode: "install" | "sync";
  /** Defaults to process.env; injected in tests to exercise the opt-out. */
  env?: NodeJS.ProcessEnv;
}): SkillSyncResult {
  const { skillsDir, embedded, mode, env = process.env } = options;
  if (mode === "sync" && env[SKILL_SYNC_OPT_OUT] === "0") {
    return { action: "opted-out", message: `skill sync skipped (${SKILL_SYNC_OPT_OUT}=0)` };
  }
  const skillDirectory = path.join(skillsDir, SKILL_NAME);
  const target = path.join(skillDirectory, "SKILL.md");
  try {
    if (mode === "sync") {
      const decision = syncDecision(readTextOrNull(target), embedded);
      if (decision === "absent") {
        return {
          action: "absent",
          message: `${SKILL_NAME} skill not installed — run 'kvasir skill install'`,
        };
      }
      if (decision === "current") {
        return { action: "up-to-date", message: `${SKILL_NAME} skill up to date` };
      }
    }
    mkdirSync(skillDirectory, { recursive: true });
    writeFileSync(target, embedded);
    return mode === "install"
      ? { action: "installed", message: `installed ${SKILL_NAME} skill → ${target}` }
      : { action: "updated", message: `refreshed ${SKILL_NAME} skill → ${target}` };
  } catch (error) {
    return {
      action: "failed",
      message: `skill ${mode} failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
