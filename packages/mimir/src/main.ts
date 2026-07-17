#!/usr/bin/env bun
// The unified `kvasir` binary's entry: route argv to one of the subcommands and
// run it. The parse is pure (./cliArgs, unit-tested); this file is the IO glue —
// it dispatches a CliCommand to the channel server, the `run` launcher, the build
// author flow, or the version/help text. Compiled to the standalone `kvasir`
// binary (bun --compile) and also invoked as `kvasir channel` by the MCP config
// `kvasir run` writes, which is how Claude spawns the channel.

import { homedir } from "node:os";
import path from "node:path";
// Embedded at --compile time by Bun; carried inside the binary so `skill install`
// works with no repo on disk (verified: the compiled binary reads it from memory).
import SKILL_MD from "../../../.claude/skills/kvasir/SKILL.md" with { type: "text" };
import { runChannel } from "./channel";
import { CLI_USAGE, type CliCommand, parseCli } from "./cliArgs";
import { runLauncher } from "./launcher";
import { runBuild } from "./runBuild";
import { isSkillSyncFailure, runSkillSync, shouldLogSyncStart } from "./skillSync";
import { VERSION } from "./version";

/** A leading token that is not a known subcommand — surfaced with usage rather
 * than silently launching, so `kvasir buld` fails loudly. */
class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

/** `~/.claude/skills` — where the /kvasir skill is installed and synced. */
const SKILLS_DIRECTORY = path.join(homedir(), ".claude", "skills");

/** Refresh the installed skill before the channel comes up — update-only and
 * failure-safe (never creates it uninvited, never throws). The log/no-log
 * decision lives in shouldLogSyncStart (tested), so this stays pure glue. */
function syncSkillOnChannelStart(): void {
  const result = runSkillSync({ skillsDir: SKILLS_DIRECTORY, embedded: SKILL_MD, mode: "sync" });
  if (shouldLogSyncStart(result)) console.error(`[kvasir] ${result.message}`);
}

async function dispatch(command: CliCommand): Promise<void> {
  switch (command.kind) {
    case "channel": {
      syncSkillOnChannelStart();
      await runChannel();
      return;
    }
    case "run": {
      await runLauncher(command.forward);
      return;
    }
    case "build": {
      process.stdout.write(`${await runBuild(command.draft)}\n`);
      return;
    }
    case "skill": {
      if (command.action === undefined) {
        throw new CliError(`kvasir skill: expected 'install' or 'sync'\n\n${CLI_USAGE}`);
      }
      const result = runSkillSync({ skillsDir: SKILLS_DIRECTORY, embedded: SKILL_MD, mode: command.action });
      process.stdout.write(`${result.message}\n`);
      if (isSkillSyncFailure(result)) process.exitCode = 1;
      return;
    }
    case "version": {
      process.stdout.write(`${VERSION}\n`);
      return;
    }
    case "help": {
      process.stdout.write(`${CLI_USAGE}\n`);
      return;
    }
    case "unknown": {
      throw new CliError(`kvasir: unknown command '${command.token}'\n\n${CLI_USAGE}`);
    }
    default: {
      // Exhaustive over CliCommand — a new kind without a case fails to compile.
      const unhandled: never = command;
      throw new CliError(`unreachable command: ${JSON.stringify(unhandled)}`);
    }
  }
}

try {
  await dispatch(parseCli(Bun.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
