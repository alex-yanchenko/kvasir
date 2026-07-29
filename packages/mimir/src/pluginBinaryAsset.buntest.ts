// Runs under `bun test` (spawns bash). The plugin's install-binary.sh maps `uname` → the
// release asset and hardcodes the release repo in bash, independently of install.ts (a
// plugin ships no TS to call). This test asserts the bash mappings agree with
// binaryAssetName() and RELEASE_REPO for every supported platform, so the plugin downloads
// exactly the assets release.yml publishes, from the same repo. The script's `--print-*`
// dry-runs compute the values without any IO.
import path from "node:path";
import { describe, expect, it } from "bun:test";
import { binaryAssetName, RELEASE_REPO } from "./install";

const SCRIPT = path.resolve(import.meta.dir, "../../../plugin/scripts/install-binary.sh");

const CASES = [
  { uname: "Darwin arm64", platform: "darwin", arch: "arm64" },
  { uname: "Darwin x86_64", platform: "darwin", arch: "x64" },
  { uname: "Linux x86_64", platform: "linux", arch: "x64" },
  { uname: "Linux aarch64", platform: "linux", arch: "arm64" },
] as const;

const printField = (flag: string, uname = ""): string =>
  Bun.spawnSync(["bash", SCRIPT, flag], { env: { ...process.env, KVASIR_TEST_UNAME: uname } })
    .stdout.toString()
    .trim();

describe("install-binary.sh mappings", () => {
  for (const { uname, platform, arch } of CASES) {
    it(`${uname} matches binaryAssetName(${platform}, ${arch})`, () => {
      // binaryAssetName returns string|null; toBe doesn't constrain the expected arg to the
      // actual's type, so comparing it against the bash string type-checks.
      expect(binaryAssetName(platform, arch)).toBe(printField("--print-asset", uname));
    });
  }

  it("an unsupported platform prints no asset (the caller is told to build from source)", () => {
    expect(printField("--print-asset", "SunOS sparc")).toBe("");
  });

  it("downloads from the same repo install.ts releases from", () => {
    expect(printField("--print-repo")).toBe(RELEASE_REPO);
  });
});
