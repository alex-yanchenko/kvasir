#!/usr/bin/env bash
# SessionStart hook: put the `kvasir` binary on ~/.local/bin the first time this plugin
# version is seen (and again after a version bump), then get out of the way. The channel
# itself is still started by `kvasir run` — this only ensures the binary exists.
#
# Dependency-free by necessity: a plugin ships no bun/node, so the fetch+verify logic that
# lives (typed + tested) in packages/mimir/scripts/setup.ts is mirrored here in bash. The
# asset-name mapping + release repo are held to install.ts by pluginBinaryAsset.buntest.ts.
#
# NEVER blocks the session: every failure warns on stderr and exits 0, and the network
# calls are time-bounded, so a stalled gh can't hang SessionStart.
set -uo pipefail

REPO="alex-yanchenko/kvasir"
BIN_DIR="${HOME}/.local/bin"

# os/arch → release asset, matching binaryAssetName() (install.ts). KVASIR_TEST_UNAME lets
# a test inject "Darwin arm64" etc. without a real uname.
read -r raw_os raw_arch <<<"${KVASIR_TEST_UNAME:-$(uname -s) $(uname -m)}"
case "$raw_os" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  *) os="" ;;
esac
case "$raw_arch" in
  arm64 | aarch64) arch="arm64" ;;
  x86_64 | amd64) arch="x64" ;;
  *) arch="" ;;
esac
asset=""
[ -n "$os" ] && [ -n "$arch" ] && asset="kvasir-${os}-${arch}"

# Dry-runs for the parity test: print a value and stop before any IO.
case "${1:-}" in
  --print-asset)
    echo "$asset"
    exit 0
    ;;
  --print-repo)
    echo "$REPO"
    exit 0
    ;;
esac

warn() { echo "[kvasir plugin] $1" >&2; }

# Bound a network call so a stalled gh can't hang the hook. Stock macOS has no `timeout`;
# fall back to running unbounded there (gh has its own connection timeouts).
run_bounded() {
  if command -v timeout >/dev/null 2>&1; then
    timeout 60 "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout 60 "$@"
  else
    "$@"
  fi
}

[ -z "$asset" ] && {
  warn "no prebuilt binary for ${raw_os}/${raw_arch} — build from source (see the kvasir README)."
  exit 0
}

# Pin to the plugin's own version (one version train): download that release's tag. Extract
# it from plugin.json without jq (a plugin ships no tooling), and keep only characters a
# semver-ish tag uses so it can never traverse out of the marker dir or inject a gh arg.
plugin_json="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}/.claude-plugin/plugin.json"
version="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$plugin_json" | head -1 | tr -cd 'A-Za-z0-9._-')"
[ -z "$version" ] && {
  warn "could not read the plugin version — skipping binary install."
  exit 0
}

# Install once per version: the marker lives in the persistent per-plugin data dir, so an
# update (new version → new marker path) re-installs, but every other session is a no-op.
data_dir="${CLAUDE_PLUGIN_DATA:-${HOME}/.kvasir/plugin}"
marker="${data_dir}/installed-${version}"
[ -f "$marker" ] && [ -x "${BIN_DIR}/kvasir" ] && exit 0

command -v gh >/dev/null 2>&1 || {
  warn "install needs the GitHub CLI (gh) — install it, then restart your session."
  exit 0
}

mkdir -p "$BIN_DIR" "$data_dir" || {
  warn "couldn't create ${BIN_DIR} or ${data_dir} — check permissions."
  exit 0
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
out="${tmp}/${asset}"

run_bounded gh release download "v${version}" --repo "$REPO" --pattern "$asset" --output "$out" --clobber >/dev/null 2>&1 || {
  warn "couldn't download ${asset} for v${version} — the release may still be publishing; retry shortly."
  exit 0
}

# Fail closed: refuse an asset whose build provenance doesn't verify against this repo's
# attestations (a tampered/unattested binary), rather than chmod+exec it.
run_bounded gh attestation verify "$out" --repo "$REPO" >/dev/null 2>&1 || {
  warn "refusing ${asset}: build-provenance attestation did not verify (or gh is too old to check — upgrade gh)."
  exit 0
}

install -m 755 "$out" "${BIN_DIR}/kvasir" 2>/dev/null || {
  cp "$out" "${BIN_DIR}/kvasir" && chmod 755 "${BIN_DIR}/kvasir"
} || {
  warn "couldn't write ${BIN_DIR}/kvasir — check permissions."
  exit 0
}

# One marker per version; drop older ones so they don't accumulate. A failed marker write
# isn't fatal (the binary is installed) — just note the next session will re-check.
rm -f "${data_dir}"/installed-* 2>/dev/null
: >"$marker" 2>/dev/null || warn "installed kvasir ${version}, but couldn't record the marker — will re-check next session."

case ":${PATH}:" in
  *":${BIN_DIR}:"*) warn "installed kvasir ${version} → ${BIN_DIR}/kvasir." ;;
  *) warn "installed kvasir ${version} → ${BIN_DIR}/kvasir (add ${BIN_DIR} to your PATH)." ;;
esac
exit 0
