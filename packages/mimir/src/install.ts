// Pure helpers for the kvasir installer + CLI: arg parsing, the help text, the
// platform→binary mapping, and the .mcp.json / settings.json merges. No side
// effects, no Bun/fs APIs — the shell glue that uses these lives in
// scripts/setup.ts, so the decision logic here stays unit-testable on Node.
// isRecord/isUnknownArray are defined locally (not imported from ./guard, which
// pulls in @kvasir/runes) so this module stays dependency-free — setup.ts runs it on
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
  - sets up the extension (builds it with pnpm, else downloads the prebuilt bundle)
  - compiles or downloads the channel into a standalone binary in ~/.kvasir/bin
  - installs the \`kvasir\` CLI on PATH (run the channel + build walkthroughs)
  - registers the channel binary in this repo's .mcp.json (server key: kvasir)

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
 * servers. `command` is the compiled channel binary (args empty) or the "bun" /
 * ["run", channel.ts] fallback when no binary could be produced. Returns a new
 * object; never mutates the input. */
export function withKvasirServer(
  previous: unknown,
  command: string,
  args: readonly string[] = [],
): Record<string, unknown> {
  const config = isRecord(previous) ? { ...previous } : {};
  const servers = isRecord(config.mcpServers) ? { ...config.mcpServers } : {};
  servers.kvasir = { command, args: [...args] };
  config.mcpServers = servers;
  return config;
}

/** The bun `--compile --target` triple we publish a prebuilt channel binary for,
 * or null for an unsupported platform/arch (caller compiles locally or errors). */
export function bunTarget(platform: string, arch: string): string | null {
  switch (`${platform}/${arch}`) {
    case "darwin/arm64": {
      return "bun-darwin-arm64";
    }
    case "darwin/x64": {
      return "bun-darwin-x64";
    }
    case "linux/x64": {
      return "bun-linux-x64";
    }
    case "linux/arm64": {
      return "bun-linux-arm64";
    }
    default: {
      return null;
    }
  }
}

/** Release asset filename for a platform's prebuilt channel binary, or null when
 * unsupported. Mirrors the names release.yml uploads. */
export function channelAssetName(platform: string, arch: string): string | null {
  const target = bunTarget(platform, arch);
  return target ? `kvasir-channel-${target.replace(/^bun-/, "")}` : null;
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

/** How the channel binary was obtained this install run. `compiled`/`downloaded`
 * = produced now; `reused` = a binary from a prior run was left in place (e.g.
 * compile failed with no node_modules but an older standalone binary exists);
 * `none` = no binary at all, so we register the bun-run fallback. The installer
 * picks this from the actual run outcome — never from a bare existsSync, which
 * can't tell a freshly-built binary from a stale leftover. */
export type ChannelOutcome = "compiled" | "downloaded" | "reused" | "none";

export interface ChannelRegistration {
  command: string;
  args: string[];
  /** Trailing note for the "registered 'kvasir' …" line, describing provenance. */
  label: string;
}

/** Map a channel-binary outcome to the .mcp.json server entry + an honest log
 * note. `none` falls back to `bun run channel.ts` (needs node_modules at run
 * time — a dev-clone convenience, not the standalone path). Exhaustive over
 * ChannelOutcome: adding a variant without a case is a compile error. */
export function channelRegistration(
  outcome: ChannelOutcome,
  binary: string,
  channelSource: string,
): ChannelRegistration {
  switch (outcome) {
    case "compiled": {
      return { command: binary, args: [], label: "(compiled binary)" };
    }
    case "downloaded": {
      return { command: binary, args: [], label: "(downloaded prebuilt binary)" };
    }
    case "reused": {
      return {
        command: binary,
        args: [],
        label: "(existing binary — re-run after 'pnpm install' to refresh)",
      };
    }
    case "none": {
      return {
        command: "bun",
        args: ["run", channelSource],
        label: "(bun run — install bun + run 'pnpm install', or gh, for a standalone binary)",
      };
    }
  }
}

/** The ~/.local/bin/kvasir shim. `run` (the default) needs only Claude — it frees
 * the single-owner :8799 bridge then launches Claude with the channel from the
 * repo dir (so Claude loads this repo's .mcp.json). `build` is the walkthrough
 * author flow and still needs bun. No bun on the review path → the floor is
 * claude + gh + the compiled channel binary. */
export function kvasirShim(repoDirectory: string): string {
  return `#!/usr/bin/env bash
set -euo pipefail
cmd="\${1:-run}"
case "$cmd" in
  build)
    shift || true
    if ! command -v bun >/dev/null 2>&1; then
      echo "kvasir build needs bun (the walkthrough author flow): https://bun.sh" >&2
      exit 1
    fi
    exec bun run "${repoDirectory}/packages/mimir/scripts/buildReview.ts" "$@"
    ;;
  run)
    shift || true
    if command -v lsof >/dev/null 2>&1; then
      pids="$(lsof -nP -iTCP:8799 -sTCP:LISTEN -t 2>/dev/null || true)"
      if [ -n "$pids" ]; then
        echo "kvasir: closing the existing :8799 bridge ($pids)" >&2
        kill $pids 2>/dev/null || true
        for _ in $(seq 1 25); do
          lsof -nP -iTCP:8799 -sTCP:LISTEN -t >/dev/null 2>&1 || break
          sleep 0.2
        done
      fi
    fi
    cd "${repoDirectory}"
    exec claude --dangerously-load-development-channels server:kvasir "$@"
    ;;
  *)
    echo "usage: kvasir [run] | kvasir build <draft.json>" >&2
    exit 1
    ;;
esac
`;
}
