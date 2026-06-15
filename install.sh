#!/usr/bin/env bash
# Kvasir installer entry point. All logic lives in packages/mimir/scripts/setup.ts
# (typed + unit-tested); this just ensures bun is present and hands off. Run with
# --help for usage, or --copy / --allow-push for options.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v bun >/dev/null 2>&1; then
  echo "kvasir install needs bun — install it from https://bun.sh, then re-run ./install.sh" >&2
  exit 1
fi
exec bun run "$DIR/packages/mimir/scripts/setup.ts" "$@"
