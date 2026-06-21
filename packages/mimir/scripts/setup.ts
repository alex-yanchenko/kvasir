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
  channelAssetName,
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
if (have("claude")) ok("claude");
else warn("claude missing — needed to serve the channel (https://docs.claude.com/claude-code)");
if (have("gh")) {
  ok("gh");
  const authed = Bun.spawnSync(["gh", "auth", "status"], { stdout: "ignore", stderr: "ignore" });
  if (authed.exitCode === 0) ok("gh authenticated");
  else warn("gh not authenticated — run 'gh auth login' (PR data needs it)");
} else warn("gh missing — needed for PR data");
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

// The extension bundle is NOT committed: pnpm present → build it fresh; else reuse
// an existing dist; else download the prebuilt dist (extension-dist.tgz) from the
// latest release. So a no-pnpm install still gets a loadable extension.
console.log("Extension:");
const distributionDirectory = path.join(REPO, "packages/extension/dist");
const distributionEntry = path.join(distributionDirectory, "content.js");
if (have("pnpm")) {
  const built = Bun.spawnSync(["sh", "-c", `cd "${REPO}" && pnpm install --frozen-lockfile && pnpm build`], {
    stdout: "ignore",
    stderr: "ignore",
  });
  if (built.exitCode === 0) ok("built → packages/extension/dist");
  else warn("build failed — run 'pnpm build' manually");
} else if (existsSync(distributionEntry)) {
  ok("using existing extension/dist");
} else if (have("gh")) {
  mkdirSync(distributionDirectory, { recursive: true });
  const tarball = path.join(distributionDirectory, "extension-dist.tgz");
  const downloaded = Bun.spawnSync(
    // prettier-ignore
    ["gh", "release", "download", "--repo", "alex-yanchenko/kvasir", "--pattern", "extension-dist.tgz", "--output", tarball, "--clobber"],
    { stdout: "ignore", stderr: "ignore" },
  );
  const extracted =
    downloaded.exitCode === 0 &&
    Bun.spawnSync(["tar", "xzf", tarball, "-C", REPO + "/packages/extension"], {
      stdout: "ignore",
      stderr: "ignore",
    }).exitCode === 0;
  if (extracted) {
    rmSync(tarball, { force: true });
    ok("downloaded prebuilt extension → packages/extension/dist");
  } else warn("extension download failed (no release yet?) — install pnpm and run 'pnpm build'");
} else {
  warn("need pnpm (to build) or gh (to download) for the extension — then load packages/extension");
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

// Compile (or download) the channel into a standalone binary so the running
// channel needs neither bun nor node_modules — the floor is claude + gh + binary.
// bun present → compile locally; else gh → download the platform's release asset;
// neither → register the bun-run fallback (so a dev clone still works).
console.log("Channel binary:");
const channelSource = path.join(REPO, "packages/mimir/src/channel.ts");
const channelBinDirectory = path.join(HOME, ".kvasir/bin");
mkdirSync(channelBinDirectory, { recursive: true });
const channelBinary = path.join(channelBinDirectory, "kvasir-channel");
if (have("bun")) {
  const compiled = Bun.spawnSync(["bun", "build", channelSource, "--compile", "--outfile", channelBinary], {
    stdout: "ignore",
    stderr: "ignore",
  });
  if (compiled.exitCode === 0) ok(`compiled channel → ${channelBinary}`);
  else warn("channel compile failed — registering the 'bun run' fallback instead");
} else {
  const asset = channelAssetName(process.platform, process.arch);
  if (!asset) {
    warn(`no prebuilt channel for ${process.platform}/${process.arch} — install bun to compile it locally`);
  } else if (have("gh")) {
    const downloaded = Bun.spawnSync(
      // prettier-ignore
      ["gh", "release", "download", "--repo", "alex-yanchenko/kvasir", "--pattern", asset, "--output", channelBinary, "--clobber"],
      { stdout: "ignore", stderr: "ignore" },
    );
    if (downloaded.exitCode === 0) {
      chmodSync(channelBinary, 0o755);
      ok(`downloaded channel → ${channelBinary}`);
    } else warn("channel download failed (no release yet?) — install bun to compile it locally");
  } else {
    warn("need bun (to compile) or gh (to download) for the channel binary");
  }
}

console.log("Channel registration:");
const mcpPath = path.join(REPO, ".mcp.json");
let mcpPrevious: unknown = {};
if (existsSync(mcpPath)) {
  try {
    mcpPrevious = JSON.parse(readFileSync(mcpPath, "utf8"));
  } catch {
    mcpPrevious = {};
  }
}
const haveBinary = existsSync(channelBinary);
const merged = haveBinary
  ? withKvasirServer(mcpPrevious, channelBinary)
  : withKvasirServer(mcpPrevious, "bun", ["run", channelSource]);
writeFileSync(mcpPath, `${JSON.stringify(merged, null, 2)}\n`);
ok(
  `registered 'kvasir' in ${mcpPath}` +
    (haveBinary ? " (compiled binary)" : " (bun run — install bun or gh for a standalone binary)"),
);

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
