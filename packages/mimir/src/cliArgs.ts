// Pure argv routing for the unified `kvasir` binary — no Bun/fs/process APIs, so
// the dispatch decision stays unit-testable on Node (the IO glue that acts on a
// CliCommand lives in the compiled entry, main.ts). Mirrors install.ts's split of
// pure parse logic from shell glue.
//
// Subcommand surface (grows per PR): `kvasir` / `kvasir run` launches a Claude
// session with the channel loaded; `kvasir channel` IS the MCP stdio server Claude
// spawns; `kvasir build <draft.json>` assembles a pushed review; `--version` /
// `--help` are recognized only as the leading token so `run` can forward its own
// flags (e.g. `kvasir run --model …`) straight to Claude untouched.

/** The routed command. `run.forward` is the tail passed through to Claude; `build.draft`
 * is the first non-flag argument, or undefined when none was given (the handler then
 * throws build usage). Always present under exactOptionalPropertyTypes — the field is
 * nullable, not optional, so a caller must handle the missing-draft case explicitly. */
export type CliCommand =
  | { kind: "run"; forward: string[] }
  | { kind: "channel" }
  | { kind: "build"; draft: string | undefined }
  | { kind: "version" }
  | { kind: "help" }
  | { kind: "unknown"; token: string };

/** Route argv (already sliced past the executable, i.e. Bun.argv.slice(2)) to a
 * command. A bare invocation and `run` both launch; an unrecognized leading token
 * is reported (not silently launched) so a typo like `kvasir buld` fails loudly. */
export function parseCli(argv: readonly string[]): CliCommand {
  const [first, ...rest] = argv;
  switch (first) {
    case undefined:
    case "run": {
      return { kind: "run", forward: first === undefined ? [] : rest };
    }
    case "channel": {
      return { kind: "channel" };
    }
    case "build": {
      return { kind: "build", draft: rest.find((argument) => !argument.startsWith("-")) };
    }
    case "-h":
    case "--help": {
      return { kind: "help" };
    }
    case "-v":
    case "--version": {
      return { kind: "version" };
    }
    default: {
      return { kind: "unknown", token: first };
    }
  }
}

export const CLI_USAGE = `kvasir — turn a GitHub PR into an in-browser walkthrough, powered by your Claude Code session.

Usage:
  kvasir                 start a Claude session with the kvasir channel loaded
  kvasir run [args…]     same as above; extra args are forwarded to \`claude\`
  kvasir build <draft>   assemble a pushed review from a draft JSON and print its link
  kvasir channel         run the MCP channel server (what Claude spawns — not run directly)
  kvasir --version       print the version
  kvasir --help          show this help

The channel serves one localhost bridge; run \`kvasir\` once and any Claude session
can push a walkthrough to it. Load the Chrome extension from the Web Store, then
pair once via the panel's Settings tab.`;
