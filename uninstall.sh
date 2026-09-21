#!/usr/bin/env bash
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'uninstall.sh requires Node.js.' >&2
  exit 1
fi

repo_root="$(cd -- "$(dirname -- "$0")" && pwd)"
node "$repo_root/uninstall.cjs" "$@"

# Older releases copied launchers here.
if [ -d /usr/local/bin ] && [ -w /usr/local/bin ]; then
  rm -f /usr/local/bin/cc-switch /usr/local/bin/cc-sync-oauth
fi
