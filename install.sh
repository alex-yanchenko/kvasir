#!/usr/bin/env bash
# Kvasir installer — makes the repo's skills available to every Claude
# Code session and gets the extension ready to load.
#
#   ./install.sh          copy skills into ~/.claude/skills (re-run to re-sync)
#   ./install.sh --link    symlink instead (live-edit during development)
#
# Copy is the default to match the "self-contained ~/.claude, no symlinks" config
# convention; --link is for when you're actively editing the skills here.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_SRC="$REPO_DIR/.claude/skills"
SKILLS_DEST="$HOME/.claude/skills"
LINK=0
[[ "${1:-}" == "--link" ]] && LINK=1

say() { printf '  %s\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }

echo "Kvasir install"

# 1. Prereq doctor — warn, don't fail; the user may install later.
echo "Prerequisites:"
command -v bun >/dev/null 2>&1 && ok "bun $(bun --version)" || warn "bun missing — needed to run the channel (https://bun.sh)"
command -v gh  >/dev/null 2>&1 && ok "gh $(gh --version | head -1 | awk '{print $3}')" || warn "gh missing — needed for PR data"
command -v pnpm >/dev/null 2>&1 && ok "pnpm $(pnpm --version)" || warn "pnpm missing — needed to build the extension"

# 2. Install skills globally (copy, or symlink with --link).
echo "Skills → $SKILLS_DEST:"
mkdir -p "$SKILLS_DEST"
for dir in "$SKILLS_SRC"/*/; do
  [[ -d "$dir" ]] || continue
  name="$(basename "$dir")"
  dest="$SKILLS_DEST/$name"
  rm -rf "$dest"
  if [[ "$LINK" == 1 ]]; then
    ln -s "${dir%/}" "$dest"
    ok "linked $name"
  else
    cp -R "$dir" "$dest"
    ok "copied $name"
  fi
done

# 3. Build the extension so packages/extension/ is ready to load unpacked.
if command -v pnpm >/dev/null 2>&1; then
  echo "Building the extension:"
  ( cd "$REPO_DIR" && pnpm install --frozen-lockfile >/dev/null 2>&1 && pnpm build >/dev/null 2>&1 ) \
    && ok "built → packages/extension/dist" || warn "build failed — run 'pnpm build' manually"
fi

# 4. Install the `kvasir` CLI on PATH: `kvasir` launches the channel; `kvasir build
# <draft>` drives the deterministic walkthrough builder from any session.
echo "CLI:"
BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/kvasir" <<WRAP
#!/usr/bin/env bash
# Kvasir CLI. \`kvasir\` (or \`kvasir run\`) launches Claude with the channel;
# \`kvasir build <draft.json>\` builds + pushes a walkthrough.
REPO="$REPO_DIR"
case "\${1:-run}" in
  build) shift; exec bun run "\$REPO/packages/mimir/scripts/buildReview.ts" "\$@" ;;
  run|"") exec claude --dangerously-load-development-channels server:kvasir ;;
  *) printf 'usage: kvasir [run] | kvasir build <draft.json>\n' >&2; exit 1 ;;
esac
WRAP
chmod +x "$BIN_DIR/kvasir"
case ":$PATH:" in
  *":$BIN_DIR:"*) ok "installed kvasir → $BIN_DIR" ;;
  *) warn "installed kvasir → $BIN_DIR (add it to PATH: export PATH=\"\$HOME/.local/bin:\$PATH\")" ;;
esac

# 5. Next steps the script deliberately does NOT automate.
cat <<EOF

Done. To finish setup:

  1. Load the extension (once): chrome://extensions → Developer mode →
     Load unpacked → $REPO_DIR/packages/extension

  2. Register the channel in your project .mcp.json under the key "kvasir",
     pointing at $REPO_DIR/packages/mimir/src/channel.ts.

  3. Run the channel (one instance serves every session):
     kvasir

  4. Skip the push permission prompt — add this to ~/.claude/settings.json
     under "permissions" → "allow" (not auto-edited here to avoid clobbering it):

       "Bash(curl:*localhost:8799*)"

Push a walkthrough from any session with the /kvasir skill.
EOF
