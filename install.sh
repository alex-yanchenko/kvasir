#!/usr/bin/env bash
# Kvasir installer — makes the repo's skills available to every Claude Code
# session, wires the channel into this repo's .mcp.json, installs the `kvasir`
# CLI, and gets the extension ready to load.
#
#   ./install.sh          copy skills into ~/.claude/skills (re-run to re-sync)
#   ./install.sh --link   symlink instead (live-edit during development)
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
command -v python3 >/dev/null 2>&1 || warn "python3 missing — can't auto-write .mcp.json (will print the step instead)"

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

# 4. Install the `kvasir` CLI on PATH. `kvasir` launches the channel (from the
# repo dir, so the repo's .mcp.json is always found regardless of where you run
# it); `kvasir build <draft>` drives the deterministic builder from any session.
echo "CLI:"
BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/kvasir" <<WRAP
#!/usr/bin/env bash
# Kvasir CLI. \`kvasir\` (or \`kvasir run\`) launches Claude with the channel,
# freeing the single-owner :8799 bridge first; \`kvasir build <draft.json>\`
# builds + pushes a walkthrough.
REPO="$REPO_DIR"
free_bridge() {
  command -v lsof >/dev/null 2>&1 || return 0
  local pids; pids=\$(lsof -nP -iTCP:8799 -sTCP:LISTEN -t 2>/dev/null || true)
  [ -n "\$pids" ] || return 0
  echo "kvasir: closing the existing :8799 bridge (pids: \$(echo \$pids | tr '\n' ' '))" >&2
  kill \$pids 2>/dev/null || true
  local i=0
  while lsof -nP -iTCP:8799 -sTCP:LISTEN >/dev/null 2>&1 && [ "\$i" -lt 25 ]; do sleep 0.2; i=\$((i+1)); done
}
case "\${1:-run}" in
  build) shift; exec bun run "\$REPO/packages/mimir/scripts/buildReview.ts" "\$@" ;;
  run|"") free_bridge; cd "\$REPO" && exec claude --dangerously-load-development-channels server:kvasir ;;
  *) printf 'usage: kvasir [run] | kvasir build <draft.json>\n' >&2; exit 1 ;;
esac
WRAP
chmod +x "$BIN_DIR/kvasir"
case ":$PATH:" in
  *":$BIN_DIR:"*) ok "installed kvasir → $BIN_DIR" ;;
  *) warn "installed kvasir → $BIN_DIR (add it to PATH: export PATH=\"\$HOME/.local/bin:\$PATH\")" ;;
esac

# 5. Wire the channel into the repo's .mcp.json (the dir `kvasir` launches from),
# idempotently, preserving any other servers. This is what `server:kvasir` resolves.
echo "Channel registration:"
if command -v python3 >/dev/null 2>&1; then
  if python3 "$REPO_DIR/.claude/scripts/write-mcp.py" "$REPO_DIR"; then
    ok "registered 'kvasir' in $REPO_DIR/.mcp.json"
  else
    warn "couldn't write .mcp.json — add a \"kvasir\" mcpServers entry manually"
  fi
else
  warn "python3 missing — add a \"kvasir\" entry to $REPO_DIR/.mcp.json pointing at packages/mimir/src/channel.ts"
fi

# 6. The remaining steps. The permission line is PRINTED, not auto-added: an
# installer silently widening the agent's allow-rules is exactly what you'd want
# to eyeball, so you add it yourself (one line, optional — skips a prompt per push).
cat <<EOF

Done. To finish:

  1. Load the extension (once): chrome://extensions -> Developer mode ->
     Load unpacked -> $REPO_DIR/packages/extension

  2. Run the channel (one instance serves every session):
     kvasir

  3. (Optional) Skip the push prompt — add under "permissions" -> "allow" in
     ~/.claude/settings.json:

       "Bash(kvasir:*)"

Then: ask "build a walkthrough for <PR url>" in that session and open the PR's
Files tab, or run /kvasir from any session to push a walkthrough. Pair once via
the panel's Settings tab.
EOF
