// Assemble a Chrome-Web-Store-ready zip of the built extension: manifest.json at
// the ARCHIVE ROOT, plus every asset the manifest references (icons/, dist/). CWS —
// and Chrome's "Load unpacked" — require manifest.json at the zip root; the
// dist-only extension-dist.tgz (which setup.ts extracts over a clone that already
// has the manifest) has it nowhere, so this is the standalone loadable artifact.
// Run via bun (`pnpm package:extension` and release.yml); the pure referencedAssets()
// is unit-tested. Output goes under packages/mimir/dist so the release's existing
// kvasir-* attest/upload globs pick it up with no extra wiring.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

class PackageExtensionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackageExtensionError";
  }
}

// The asset-bearing fields of the MV3 manifest. The non-strict parse strips other
// keys, so a future manifest field that ALSO references files (options_page,
// devtools_page, sandbox.pages, …) would be dropped silently — assertModeledManifest
// below is the backstop that turns that into a loud build failure.
const manifestSchema = z.object({
  background: z.object({ service_worker: z.string().optional() }).optional(),
  content_scripts: z
    .array(z.object({ js: z.array(z.string()).optional(), css: z.array(z.string()).optional() }))
    .optional(),
  icons: z.record(z.string(), z.string()).optional(),
  action: z
    .object({
      default_icon: z.record(z.string(), z.string()).optional(),
      default_popup: z.string().optional(),
    })
    .optional(),
  web_accessible_resources: z.array(z.object({ resources: z.array(z.string()).optional() })).optional(),
});
type ExtensionManifest = z.infer<typeof manifestSchema>;

// Top-level manifest keys that legitimately reference no files. A key that is neither
// modeled by manifestSchema nor listed here is treated as a possible unpackaged-asset
// source (see assertModeledManifest).
const METADATA_KEYS = new Set([
  "manifest_version",
  "name",
  "short_name",
  "version",
  "description",
  "author",
  "homepage_url",
  "permissions",
  "host_permissions",
  "default_locale",
  "minimum_chrome_version",
  "key",
]);

// Fail the build if the manifest carries an unrecognized TOP-LEVEL key this module
// neither models nor knows to be file-less — so a future MV3 top-level asset field
// fails loudly instead of silently shipping a package missing that file. Scope is
// top-level only: a new asset field NESTED under a modeled key (e.g. action.*) must be
// added to manifestSchema + referencedAssets directly, it is not caught here. A
// top-level array falls through to manifestSchema.parse for its clearer error.
function assertModeledManifest(parsed: unknown): void {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
  const modeled = new Set(Object.keys(manifestSchema.shape));
  const unmodeled = Object.keys(parsed).filter((key) => !modeled.has(key) && !METADATA_KEYS.has(key));
  if (unmodeled.length > 0) {
    throw new PackageExtensionError(
      `unmodeled manifest key(s) may reference unpackaged files: ${unmodeled.join(", ")}`,
    );
  }
}

/** Every file the MV3 manifest points at, plus the manifest itself — the exact,
 * minimal set a loadable/CWS package must contain. Deduped + sorted so the archive
 * is deterministic and no referenced asset can be silently omitted. */
export function referencedAssets(manifest: ExtensionManifest): string[] {
  const files = new Set<string>(["manifest.json"]);
  if (manifest.background?.service_worker) files.add(manifest.background.service_worker);
  for (const script of manifest.content_scripts ?? []) {
    for (const js of script.js ?? []) files.add(js);
    for (const css of script.css ?? []) files.add(css);
  }
  for (const icon of Object.values(manifest.icons ?? {})) files.add(icon);
  for (const icon of Object.values(manifest.action?.default_icon ?? {})) files.add(icon);
  if (manifest.action?.default_popup) files.add(manifest.action.default_popup);
  for (const entry of manifest.web_accessible_resources ?? []) {
    for (const resource of entry.resources ?? []) files.add(resource);
  }
  return [...files].toSorted((left, right) => Number(left > right) - Number(left < right));
}

/** Stage exactly the referenced files (cpSync throws ENOENT if the build didn't emit
 * one — the guard that keeps a broken package from shipping), then zip from the
 * staging root so manifest.json lands at the archive root and nothing extraneous
 * (source maps, node_modules) leaks in. Returns the archived paths for the caller. */
export function packageExtension(extensionDirectory: string, outputZip: string): string[] {
  const parsed: unknown = JSON.parse(readFileSync(path.join(extensionDirectory, "manifest.json"), "utf8"));
  assertModeledManifest(parsed);
  const assets = referencedAssets(manifestSchema.parse(parsed));
  const staging = mkdtempSync(path.join(tmpdir(), "kvasir-ext-"));
  try {
    for (const asset of assets) {
      const destination = path.join(staging, asset);
      mkdirSync(path.dirname(destination), { recursive: true });
      cpSync(path.join(extensionDirectory, asset), destination);
    }
    mkdirSync(path.dirname(outputZip), { recursive: true });
    rmSync(outputZip, { force: true });
    // -X drops platform extras (uid/gid, extended attrs) for a reproducible archive.
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- "zip" is a fixed literal run against a build environment (dev/CI) PATH, not attacker input; system zip ships on both macOS and the CI ubuntu image.
    execFileSync("zip", ["-rX", outputZip, "."], { cwd: staging, stdio: "ignore" });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return assets;
}

// CLI: package the sibling extension package into packages/mimir/dist. Guarded so
// importing this module (the unit test) never triggers the IO — import.meta.main is
// true only for the direct `bun packageExtension.ts` invocation, false on import.
if (import.meta.main) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const archived = packageExtension(
    path.resolve(here, "../../extension"),
    path.resolve(here, "../dist/kvasir-extension.zip"),
  );
  console.log(`packaged kvasir-extension.zip (${archived.length} files)`);
}
