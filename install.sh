#!/usr/bin/env bash
# Kvasir installer — makes the repo's skills available to every Claude Code
# session, wires the channel into this repo's .mcp.json, installs the `kvasir`
# CLI, and gets the extension ready to load.
#
#   ./install.sh                symlink skills into ~/.claude/skills (edits here apply live)
#   ./install.sh --copy         copy a snapshot instead (re-run to re-sync)
#   ./install.sh --allow-push   also add the Bash(kvasir:*) permission so /kvasir
#                               never prompts (widens agent allow-rules — opt-in)
#
# Symlink is the default so edits to the skill in this repo take effect without
# re-running install. --copy makes a self-contained snapshot (the usual
# "no symlinks in ~/.claude" convention) for a stable, repo-independent install.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_SRC="$REPO_DIR/.claude/skills"
SKILLS_DEST="$HOME/.claude/skills"

say() { printf '  %s\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }

COPY=0
ALLOW_PUSH=0
for arg in "$@"; do
  case "$arg" in
    --copy) COPY=1 ;;
    --allow-push) ALLOW_PUSH=1 ;;
    *) warn "ignoring unknown flag: $arg" ;;
  esac
done

echo "Kvasir install"

# 1. Prereq doctor — warn, don't fail; the user may install later.
echo "Prerequisites:"
command -v bun >/dev/null 2>&1 && ok "bun $(bun --version)" || warn "bun missing — needed to run the channel (https://bun.sh)"
command -v gh  >/dev/null 2>&1 && ok "gh $(gh --version | head -1 | awk '{print $3}')" || warn "gh missing — needed for PR data"
command -v pnpm >/dev/null 2>&1 && ok "pnpm $(pnpm --version)" || warn "pnpm missing — needed to build the extension"
command -v python3 >/dev/null 2>&1 || warn "python3 missing — can't auto-write .mcp.json (will print the step instead)"

# 2. Install skills globally (symlink by default, or snapshot with --copy).
echo "Skills → $SKILLS_DEST:"
mkdir -p "$SKILLS_DEST"
for dir in "$SKILLS_SRC"/*/; do
  [[ -d "$dir" ]] || continue
  name="$(basename "$dir")"
  dest="$SKILLS_DEST/$name"
  rm -rf "$dest"
  if [[ "$COPY" == 1 ]]; then
    cp -R "$dir" "$dest"
    ok "copied $name"
  else
    ln -s "${dir%/}" "$dest"
    ok "linked $name"
  fi
done

# 3. Build the extension so packages/extension/ is ready to load unpacked.
if command -v pnpm >/dev/null 2>&1; then
  echo "Building the extension:"
  ( cd "$REPO_DIR" && pnpm install --frozen-lockfile >/dev/null 2>&1 && pnpm build >/dev/null 2>&1 ) \
    && ok "built → packages/extension/dist" || warn "build failed — run 'pnpm build' manually"
fi

# 4. Install the `kvasir` CLI on PATH. `kvasir` launches the channel (from the
# repo dir, so the repo's .mcp.json is always found) after freeing the single-owner
# :8799 bridge; `kvasir build <draft>` drives the deterministic builder.
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

# 6. Permission for the push builder. Auto-added only with --allow-push — it widens
# the agent's allow-rules globally, so it's opt-in, never the silent default.
echo "Permission:"
if [[ "$ALLOW_PUSH" == 1 ]] && command -v python3 >/dev/null 2>&1; then
  case "$(python3 "$REPO_DIR/.claude/scripts/write-permission.py")" in
    added)   ok "added 'Bash(kvasir:*)' to ~/.claude/settings.json (backup written alongside)" ;;
    present) ok "'Bash(kvasir:*)' already allowed" ;;
    *)       warn "settings.json missing/invalid — add \"Bash(kvasir:*)\" under permissions.allow yourself" ;;
  esac
elif [[ "$ALLOW_PUSH" == 1 ]]; then
  warn "python3 missing — add \"Bash(kvasir:*)\" under permissions.allow in ~/.claude/settings.json"
else
  say "to auto-skip the per-push prompt, re-run with:  ./install.sh --allow-push"
  say "(or add \"Bash(kvasir:*)\" under permissions.allow in ~/.claude/settings.json)"
fi

# 7. The two steps that genuinely can't be automated.
cat <<EOF

Done. Two manual steps remain:

  1. Load the extension (once): chrome://extensions -> Developer mode ->
     Load unpacked -> $REPO_DIR/packages/extension

  2. Run the channel (one instance serves every session):
     kvasir

Then: ask "build a walkthrough for <PR url>" in that session and open the PR's
Files tab, or run /kvasir from any session to push a walkthrough. Pair once via
the panel's Settings tab.
EOF
