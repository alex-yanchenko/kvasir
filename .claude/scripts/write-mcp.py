#!/usr/bin/env python3
"""Idempotently register the kvasir channel in <repo>/.mcp.json.

Preserves any other mcpServers entries. Run by install.sh; safe to re-run.
"""
import json
import os
import sys


def main() -> int:
    repo = sys.argv[1]
    path = os.path.join(repo, ".mcp.json")
    cfg = {}
    if os.path.exists(path):
        try:
            cfg = json.load(open(path))
        except (ValueError, OSError):
            cfg = {}
    servers = cfg.setdefault("mcpServers", {})
    servers["kvasir"] = {
        "command": "bun",
        "args": ["run", os.path.join(repo, "packages/mimir/src/channel.ts")],
    }
    with open(path, "w") as f:
        json.dump(cfg, f, indent=2)
        f.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
