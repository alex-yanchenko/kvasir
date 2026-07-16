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
  attestationVerifyArgs,
  binaryAssetName,
  type BinaryOutcome,
  channelRegistration,
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

// Verify a downloaded release asset's build-provenance attestation before we trust
// it (chmod+exec the channel, or extract the extension into Chrome). Fail-closed:
// if gh can't verify — an old gh without `attestation`, offline, or a genuinely
// tampered/unattested asset — refuse the download and fall back to building from
// source rather than run an unverified binary.
const attestationOk = (file: string): boolean =>
  Bun.spawnSync(["gh", ...attestationVerifyArgs(file)], { stdout: "ignore", stderr: "ignore" }).exitCode ===
  0;

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
  // Verify provenance before extracting into the loaded extension — a tampered
  // tarball runs as a content script on github.com.
  const verified = downloaded.exitCode === 0 && attestationOk(tarball);
  const extracted =
    verified &&
    Bun.spawnSync(["tar", "xzf", tarball, "-C", REPO + "/packages/extension"], {
      stdout: "ignore",
      stderr: "ignore",
    }).exitCode === 0;
  if (extracted) {
    rmSync(tarball, { force: true });
    ok("downloaded prebuilt extension → packages/extension/dist");
  } else if (downloaded.exitCode === 0 && !verified) {
    rmSync(tarball, { force: true });
    warn("extension download failed provenance verification — refusing; install pnpm and run 'pnpm build'");
  } else warn("extension download failed (no release yet?) — install pnpm and run 'pnpm build'");
} else {
  warn("need pnpm (to build) or gh (to download) for the extension — then load packages/extension");
}

// Get the unified binary so the running channel needs neither bun nor
// node_modules — the floor is claude + gh + binary. bun + the repo's node_modules
// → compile locally; if that's unavailable or fails (e.g. a no-pnpm clone with
// nothing to resolve @kvasir/runes against) → download the platform's prebuilt
// release asset; if a usable binary from a prior run is still in place → keep it;
// otherwise → fall back to running the entry from source via bun.
console.log("kvasir binary:");
const binarySource = path.join(REPO, "packages/mimir/src/main.ts");
const kvasirBinDirectory = path.join(HOME, ".kvasir/bin");
mkdirSync(kvasirBinDirectory, { recursive: true });
const kvasirBinary = path.join(kvasirBinDirectory, "kvasir");
const hadPriorBinary = existsSync(kvasirBinary);

let binaryOutcome: BinaryOutcome = "none";
if (have("bun")) {
  const compiled = Bun.spawnSync(["bun", "build", binarySource, "--compile", "--outfile", kvasirBinary], {
    stdout: "ignore",
    stderr: "ignore",
  });
  if (compiled.exitCode === 0) {
    ok(`compiled kvasir → ${kvasirBinary}`);
    binaryOutcome = "compiled";
  } else warn("kvasir compile failed (no node_modules to resolve deps?) — trying the prebuilt download");
}
if (binaryOutcome === "none") {
  const asset = binaryAssetName(process.platform, process.arch);
  if (asset && have("gh")) {
    const downloaded = Bun.spawnSync(
      // prettier-ignore
      ["gh", "release", "download", "--repo", "alex-yanchenko/kvasir", "--pattern", asset, "--output", kvasirBinary, "--clobber"],
      { stdout: "ignore", stderr: "ignore" },
    );
    // Verify provenance before we chmod+exec the downloaded binary.
    if (downloaded.exitCode === 0 && attestationOk(kvasirBinary)) {
      chmodSync(kvasirBinary, 0o755);
      ok(`downloaded kvasir → ${kvasirBinary}`);
      binaryOutcome = "downloaded";
    } else if (downloaded.exitCode === 0) {
      rmSync(kvasirBinary, { force: true });
      warn(
        "kvasir download failed provenance verification — refusing (upgrade gh, or 'pnpm install' to compile)",
      );
    } else warn("kvasir download failed (no release yet?)");
  } else if (asset) {
    warn("need gh to download kvasir (or 'pnpm install' so bun can compile it locally)");
  } else {
    warn(
      `no prebuilt kvasir for ${process.platform}/${process.arch} — install bun + run 'pnpm install' to compile`,
    );
  }
}
// Compile/download both failed but a standalone binary from a prior run survives:
// keep it rather than dropping to the deps-requiring bun-run fallback.
if (binaryOutcome === "none" && hadPriorBinary && existsSync(kvasirBinary)) {
  binaryOutcome = "reused";
  ok(`keeping the existing kvasir binary → ${kvasirBinary}`);
}

// The kvasir CLI on PATH forwards to the standalone binary when we have one, else
// runs the entry from source via bun (a dev-clone convenience). Either way the one
// router handles run/channel/build/version/help.
console.log("CLI:");
const binDirectory = path.join(HOME, ".local/bin");
mkdirSync(binDirectory, { recursive: true });
const kvasirBin = path.join(binDirectory, "kvasir");
const onPath = (process.env.PATH ?? "").split(":").includes(binDirectory);
const pathHint = onPath ? "" : ` (add to PATH: export PATH="$HOME/.local/bin:$PATH")`;
if (binaryOutcome !== "none") {
  writeFileSync(kvasirBin, kvasirShim(kvasirBinary));
  chmodSync(kvasirBin, 0o755);
  if (onPath) ok(`installed kvasir → ${binDirectory}`);
  else warn(`installed kvasir → ${binDirectory}${pathHint}`);
} else if (have("bun")) {
  writeFileSync(kvasirBin, kvasirShim("bun", ["run", binarySource]));
  chmodSync(kvasirBin, 0o755);
  warn(
    `installed kvasir → ${binDirectory} — bun-run fallback; 'pnpm install' or a prebuilt gives a standalone binary${pathHint}`,
  );
} else {
  warn("no kvasir binary and no bun — install bun (https://bun.sh) or gh for a prebuilt to get the CLI");
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
const channelEntry = channelRegistration(binaryOutcome, kvasirBinary, binarySource);
const merged = withKvasirServer(mcpPrevious, channelEntry.command, channelEntry.args);
writeFileSync(mcpPath, `${JSON.stringify(merged, null, 2)}\n`);
ok(`registered 'kvasir' in ${mcpPath} ${channelEntry.label}`);

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
