#!/usr/bin/env python3
"""Add Bash(kvasir:*) to ~/.claude/settings.json permissions.allow.

Opt-in, invoked by `install.sh --allow-push`. Idempotent; backs up before the
first change; refuses to touch a settings.json that isn't valid JSON. Prints one
of: added | present | invalid.
"""
import json
import os
import shutil
import sys


def main() -> int:
    path = os.path.expanduser("~/.claude/settings.json")
    perm = "Bash(kvasir:*)"
    cfg = {}
    if os.path.exists(path):
        try:
            cfg = json.load(open(path))
        except (ValueError, OSError):
            print("invalid")
            return 0
    allow = cfg.setdefault("permissions", {}).setdefault("allow", [])
    if perm in allow:
        print("present")
        return 0
    if os.path.exists(path):
        shutil.copy(path, path + ".kvasir.bak")
    allow.append(perm)
    with open(path, "w") as f:
        json.dump(cfg, f, indent=2)
        f.write("\n")
    print("added")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
