// Pure helpers for the kvasir installer + CLI: arg parsing, the help text, and the
// .mcp.json / settings.json merges. No side effects, no Bun/fs APIs — the shell
// glue that uses these lives in scripts/setup.ts and scripts/kvasir.ts, so the
// decision logic here stays unit-testable on Node.
// isRecord/isUnknownArray are defined locally (not imported from ./guard, which
// pulls in @prw/runes) so this module stays dependency-free — setup.ts runs it on
// a fresh clone, before `pnpm install` has populated node_modules.
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isUnknownArray = (value: unknown): value is unknown[] => Array.isArray(value);

export interface SetupArgs {
  copy: boolean;
  allowPush: boolean;
  help: boolean;
  unknown: string[];
}

/** Parse the installer flags. Order-independent; anything unrecognized lands in `unknown`. */
export function parseSetupArgs(argv: readonly string[]): SetupArgs {
  const args: SetupArgs = { copy: false, allowPush: false, help: false, unknown: [] };
  for (const argument of argv) {
    switch (argument) {
      case "--copy": {
        args.copy = true;
        break;
      }
      case "--allow-push": {
        args.allowPush = true;
        break;
      }
      case "-h":
      case "--help": {
        args.help = true;
        break;
      }
      default: {
        args.unknown.push(argument);
      }
    }
  }
  return args;
}

export const SETUP_USAGE = `kvasir install — set up the Kvasir walkthrough tool for Claude Code.

Usage:
  ./install.sh [--copy] [--allow-push]
  ./install.sh --help

What it does (idempotent — safe to re-run):
  - installs the /kvasir skill into ~/.claude/skills (symlinked by default)
  - builds the browser extension into packages/extension/dist
  - installs the \`kvasir\` CLI on PATH (run the channel + build walkthroughs)
  - registers the channel in this repo's .mcp.json (server key: kvasir)

Options:
  --copy         copy the skill as a snapshot instead of symlinking it
                 (re-run to re-sync; the "no symlinks in ~/.claude" convention)
  --allow-push   add "Bash(kvasir:*)" to ~/.claude/settings.json so /kvasir
                 never prompts on push (opt-in; backs up settings.json first)
  -h, --help     show this help and exit

Two steps it can't do for you:
  1. chrome://extensions -> Developer mode -> Load unpacked -> packages/extension
  2. run \`kvasir\` to start the channel, then pair once via the panel's Settings tab`;

export const KVASIR_PERMISSION = "Bash(kvasir:*)";

/** Merge the kvasir channel entry into an .mcp.json object, preserving any other
 * servers. Returns a new object; never mutates the input. */
export function withKvasirServer(previous: unknown, channelPath: string): Record<string, unknown> {
  const config = isRecord(previous) ? { ...previous } : {};
  const servers = isRecord(config.mcpServers) ? { ...config.mcpServers } : {};
  servers.kvasir = { command: "bun", args: ["run", channelPath] };
  config.mcpServers = servers;
  return config;
}

/** Add the kvasir push permission to a settings.json object, idempotently. Returns
 * the (possibly unchanged) config and whether anything changed. Never mutates input. */
export function withKvasirPermission(previous: unknown): {
  config: Record<string, unknown>;
  changed: boolean;
} {
  const config = isRecord(previous) ? { ...previous } : {};
  const permissions = isRecord(config.permissions) ? { ...config.permissions } : {};
  const allow: unknown[] = isUnknownArray(permissions.allow) ? [...permissions.allow] : [];
  if (allow.includes(KVASIR_PERMISSION)) return { config, changed: false };
  allow.push(KVASIR_PERMISSION);
  permissions.allow = allow;
  config.permissions = permissions;
  return { config, changed: true };
}

/** The ~/.local/bin/kvasir shim: a one-line hand-off to the Bun CLI in this repo. */
export function kvasirShim(repoDirectory: string): string {
  return `#!/usr/bin/env bash\nexec bun run "${repoDirectory}/packages/mimir/scripts/kvasir.ts" "$@"\n`;
}
