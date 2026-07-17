// Keep the installed `/kvasir` skill in step with the binary's embedded copy.
// Two modes: `install` explicitly copies the skill in (create or overwrite);
// `sync` (run by `kvasir skill sync` and on every channel start) is UPDATE-ONLY —
// it refreshes an already-installed skill when the embedded content has drifted
// but NEVER creates it uninvited (invariant 3). Failure-safe: an unwritable home
// returns a result, never throws, so it can't break the channel or the CLI.
//
// The embedded skill is SKILL.md ONLY — the binary carries that one text file, not
// a directory tree. The contributor installer (scripts/setup.ts) copies the whole
// skill directory; this path deliberately does not, because the /kvasir skill is a
// single SKILL.md. A symlinked skill dir (setup.ts's default install) is left
// untouched — it mirrors the repo and updates via git, not the embedded snapshot.

import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** The skill's directory name under `~/.claude/skills`. */
export const SKILL_NAME = "kvasir";
/** Set `KVASIR_SKILL_SYNC=0` to opt out of the update-only sync (channel-start and
 * `skill sync`). Never gates an explicit `skill install`. Exported so the test
 * asserts against the constant rather than re-typing the literal. */
export const SKILL_SYNC_OPT_OUT = "KVASIR_SKILL_SYNC";

/** `absent` = not installed (leave it — sync never creates); `up-to-date` =
 * installed and identical; `write` = installed and drifted. */
type SyncDecision = "write" | "absent" | "up-to-date";

/** `installed` is the on-disk SKILL.md text, or null when absent. */
export function syncDecision(installed: string | null, embedded: string): SyncDecision {
  if (installed === null) return "absent";
  if (installed === embedded) return "up-to-date";
  return "write";
}

export interface SkillSyncResult {
  action: "installed" | "updated" | "up-to-date" | "absent" | "opted-out" | "symlinked" | "failed";
  /** One-line summary — printed to stdout for an explicit `skill install`/`skill
   * sync`, or to stderr only when the channel-start sync changed something, found
   * the skill missing, or failed. */
  message: string;
}

/** The channel-start auto-sync prints its result to stderr only for these actions:
 * it changed something (`updated`), the skill is missing (`absent` — surface the
 * install hint), or it failed. A healthy/no-op start (up-to-date, opted-out,
 * symlinked) stays silent so it isn't noisy on every channel start. */
const LOGGED_START_ACTIONS: ReadonlySet<SkillSyncResult["action"]> = new Set(["updated", "absent", "failed"]);

export function shouldLogSyncStart(result: SkillSyncResult): boolean {
  return LOGGED_START_ACTIONS.has(result.action);
}

/** Whether a result is an error outcome the CLI should exit non-zero on. */
export function isSkillSyncFailure(result: SkillSyncResult): boolean {
  return result.action === "failed";
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

function isSymlink(target: string): boolean {
  try {
    return lstatSync(target).isSymbolicLink();
  } catch {
    return false; // path is absent or its stat failed — nothing to protect
  }
}

/** Install or update the embedded skill. `install` always writes; `sync` writes
 * only an installed-and-drifted skill (and honors the opt-out env). A symlinked
 * skill dir is never written through (it points back at the repo). Never throws. */
export function runSkillSync(options: {
  /** The `~/.claude/skills` directory (injected so tests use a temp dir). */
  readonly skillsDir: string;
  /** The binary's embedded SKILL.md content. */
  readonly embedded: string;
  readonly mode: "install" | "sync";
  /** Defaults to process.env; injected in tests to exercise the opt-out. */
  readonly env?: NodeJS.ProcessEnv;
}): SkillSyncResult {
  const { skillsDir, embedded, mode, env = process.env } = options;
  if (mode === "sync" && env[SKILL_SYNC_OPT_OUT] === "0") {
    return { action: "opted-out", message: `skill sync skipped (${SKILL_SYNC_OPT_OUT}=0)` };
  }
  const skillDirectory = path.join(skillsDir, SKILL_NAME);
  const target = path.join(skillDirectory, "SKILL.md");
  try {
    // A symlinked skill dir (setup.ts's default) points into the git working tree;
    // writing through it would clobber the repo's tracked SKILL.md. Leave it — it
    // updates via git, not the embedded snapshot.
    if (isSymlink(skillDirectory)) {
      return {
        action: "symlinked",
        message: `${SKILL_NAME} skill is symlinked (repo-managed) — left untouched`,
      };
    }
    if (mode === "sync") {
      const decision = syncDecision(readTextOrNull(target), embedded);
      if (decision === "absent") {
        return {
          action: "absent",
          message: `${SKILL_NAME} skill not installed — run 'kvasir skill install'`,
        };
      }
      if (decision === "up-to-date") {
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
