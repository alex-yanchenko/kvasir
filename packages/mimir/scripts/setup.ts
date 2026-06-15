#!/usr/bin/env bun
/**
 * Kvasir installer — the logic behind ./install.sh. Sets up the skill, builds the
 * extension, installs the kvasir CLI, and registers the channel. Pure decision
 * logic lives in src/install.ts; this is the IO/shell glue. Idempotent.
 */
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  KVASIR_PERMISSION,
  kvasirShim,
  parseSetupArgs,
  SETUP_USAGE,
  withKvasirPermission,
  withKvasirServer,
} from "../src/install";

const REPO = path.resolve(import.meta.dir, "../../..");
const HOME = homedir();
const ok = (message: string): void => console.log(`  \u001B[32m✓\u001B[0m ${message}`);
const warn = (message: string): void => console.log(`  \u001B[33m!\u001B[0m ${message}`);
const say = (message: string): void => console.log(`  ${message}`);

const args = parseSetupArgs(Bun.argv.slice(2));
if (args.help) {
  console.log(SETUP_USAGE);
  process.exit(0);
}
for (const flag of args.unknown) warn(`unknown flag: ${flag} (see ./install.sh --help)`);

console.log("Kvasir install");

console.log("Prerequisites:");
const have = (bin: string): boolean => Bun.which(bin) !== null;
if (have("bun")) ok("bun");
else warn("bun missing — needed to run the channel (https://bun.sh)");
if (have("gh")) ok("gh");
else warn("gh missing — needed for PR data");
if (have("pnpm")) ok("pnpm");
else warn("pnpm missing — needed to build the extension");

const skillsSource = path.join(REPO, ".claude/skills");
const skillsDestination = path.join(HOME, ".claude/skills");
console.log(`Skills → ${skillsDestination}:`);
mkdirSync(skillsDestination, { recursive: true });
for (const name of readdirSync(skillsSource)) {
  const source = path.join(skillsSource, name);
  if (!lstatSync(source).isDirectory()) continue;
  const destination = path.join(skillsDestination, name);
  rmSync(destination, { recursive: true, force: true });
  if (args.copy) {
    cpSync(source, destination, { recursive: true });
    ok(`copied ${name}`);
  } else {
    symlinkSync(source, destination);
    ok(`linked ${name}`);
  }
}

if (have("pnpm")) {
  console.log("Building the extension:");
  const built = Bun.spawnSync(["sh", "-c", `cd "${REPO}" && pnpm install --frozen-lockfile && pnpm build`], {
    stdout: "ignore",
    stderr: "ignore",
  });
  if (built.exitCode === 0) ok("built → packages/extension/dist");
  else warn("build failed — run 'pnpm build' manually");
}

console.log("CLI:");
const binDirectory = path.join(HOME, ".local/bin");
mkdirSync(binDirectory, { recursive: true });
const kvasirBin = path.join(binDirectory, "kvasir");
writeFileSync(kvasirBin, kvasirShim(REPO));
chmodSync(kvasirBin, 0o755);
if ((process.env.PATH ?? "").split(":").includes(binDirectory)) {
  ok(`installed kvasir → ${binDirectory}`);
} else {
  warn(`installed kvasir → ${binDirectory} (add to PATH: export PATH="$HOME/.local/bin:$PATH")`);
}

console.log("Channel registration:");
const mcpPath = path.join(REPO, ".mcp.json");
const channelPath = path.join(REPO, "packages/mimir/src/channel.ts");
let mcpPrevious: unknown = {};
if (existsSync(mcpPath)) {
  try {
    mcpPrevious = JSON.parse(readFileSync(mcpPath, "utf8"));
  } catch {
    mcpPrevious = {};
  }
}
writeFileSync(mcpPath, `${JSON.stringify(withKvasirServer(mcpPrevious, channelPath), null, 2)}\n`);
ok(`registered 'kvasir' in ${mcpPath}`);

console.log("Permission:");
const settingsPath = path.join(HOME, ".claude/settings.json");
if (!args.allowPush) {
  say("to auto-skip the per-push prompt, re-run with:  ./install.sh --allow-push");
  say(`(or add "${KVASIR_PERMISSION}" under permissions.allow in ~/.claude/settings.json)`);
} else if (existsSync(settingsPath)) {
  let previous: unknown;
  try {
    previous = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    previous = undefined;
  }
  if (previous === undefined) {
    warn(`${settingsPath} isn't valid JSON — add "${KVASIR_PERMISSION}" under permissions.allow yourself`);
  } else {
    const { config, changed } = withKvasirPermission(previous);
    if (changed) {
      copyFileSync(settingsPath, `${settingsPath}.kvasir.bak`);
      writeFileSync(settingsPath, `${JSON.stringify(config, null, 2)}\n`);
      ok(`added '${KVASIR_PERMISSION}' to settings.json (backup: settings.json.kvasir.bak)`);
    } else {
      ok(`'${KVASIR_PERMISSION}' already allowed`);
    }
  }
} else {
  const { config } = withKvasirPermission({});
  writeFileSync(settingsPath, `${JSON.stringify(config, null, 2)}\n`);
  ok(`created ${settingsPath} with '${KVASIR_PERMISSION}'`);
}

console.log(`
Done. Two manual steps remain:

  1. Load the extension (once): chrome://extensions -> Developer mode ->
     Load unpacked -> ${path.join(REPO, "packages/extension")}

  2. Run the channel (one instance serves every session):
     kvasir

Then: ask "build a walkthrough for <PR url>" in that session and open the PR's
Files tab, or run /kvasir from any session to push a walkthrough. Pair once via
the panel's Settings tab.`);
