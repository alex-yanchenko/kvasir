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
  - compiles or downloads the kvasir binary into ~/.kvasir/bin
  - installs the \`kvasir\` CLI on PATH (run the channel + build walkthroughs)
  - registers the binary as the channel in this repo's .mcp.json (server key: kvasir, args: ["channel"])

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
 * servers. `command` is the compiled binary with `args:["channel"]`, or the
 * "bun" / ["run", main.ts, "channel"] fallback when no binary could be produced.
 * Returns a new object; never mutates the input. */
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

/** Release asset filename for a platform's prebuilt `kvasir` binary
 * (`kvasir-<platform>-<arch>`), or null when unsupported. Mirrors the names
 * release.yml uploads. */
export function binaryAssetName(platform: string, arch: string): string | null {
  const target = bunTarget(platform, arch);
  return target ? `kvasir-${target.replace(/^bun-/, "")}` : null;
}

/** The GitHub repo prebuilt release assets are published to and verified against. */
export const RELEASE_REPO = "alex-yanchenko/kvasir";

/** `gh` argv to verify a downloaded release asset's build-provenance attestation.
 * The attestation is signed by GitHub's OIDC identity for the release workflow, so
 * an asset swapped after the build fails verification — knowing the repo doesn't let
 * an attacker forge it. The installer runs this before it will chmod+exec the channel
 * binary or extract the extension into Chrome, and refuses the download on failure. */
export function attestationVerifyArgs(file: string, repo: string = RELEASE_REPO): string[] {
  return ["attestation", "verify", file, "--repo", repo];
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

/** How the kvasir binary was obtained this install run. `compiled`/`downloaded`
 * = produced now; `reused` = a binary from a prior run was left in place (e.g.
 * compile failed with no node_modules but an older standalone binary exists);
 * `none` = no binary at all, so we register the bun-run fallback. The installer
 * picks this from the actual run outcome — never from a bare existsSync, which
 * can't tell a freshly-built binary from a stale leftover. */
export type BinaryOutcome = "compiled" | "downloaded" | "reused" | "none";

export interface ChannelRegistration {
  command: string;
  args: string[];
  /** Trailing note for the "registered 'kvasir' …" line, describing provenance. */
  label: string;
}

/** Map a binary outcome to the .mcp.json channel entry + an honest log note. The
 * unified binary IS the channel when invoked as `kvasir channel`, so every
 * real-binary outcome registers `args:["channel"]`. `none` falls back to
 * `bun run <main.ts> channel` (needs node_modules at run time — a dev-clone
 * convenience, not the standalone path). Exhaustive over BinaryOutcome: adding a
 * variant without a case is a compile error. */
export function channelRegistration(
  outcome: BinaryOutcome,
  binary: string,
  binarySource: string,
): ChannelRegistration {
  switch (outcome) {
    case "compiled": {
      return { command: binary, args: ["channel"], label: "(compiled binary)" };
    }
    case "downloaded": {
      return { command: binary, args: ["channel"], label: "(downloaded prebuilt binary)" };
    }
    case "reused": {
      return {
        command: binary,
        args: ["channel"],
        label: "(existing binary — re-run after 'pnpm install' to refresh)",
      };
    }
    case "none": {
      return {
        command: "bun",
        args: ["run", binarySource, "channel"],
        label: "(bun run — install bun + run 'pnpm install', or gh, for a standalone binary)",
      };
    }
  }
}

/** The ~/.local/bin/kvasir launcher shim: `exec <command> <args…> "$@"`, forwarding
 * every user argument to the unified router. Two forms: with a standalone binary
 * it forwards to that binary (`kvasirShim(binary)` → `exec "<binary>" "$@"`); with
 * no binary it runs the entry from source (`kvasirShim("bun", ["run", main.ts])`).
 * Either way `kvasir run|build|channel|…` route through the one entry. */
export function kvasirShim(command: string, args: readonly string[] = []): string {
  const argv = [command, ...args].map((part) => `"${part}"`).join(" ");
  return `#!/usr/bin/env bash
exec ${argv} "$@"
`;
}
