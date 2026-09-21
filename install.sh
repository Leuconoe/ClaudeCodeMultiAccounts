#!/usr/bin/env bash
set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'install.sh requires Node.js.' >&2
  exit 1
fi

repo_root="$(cd -- "$(dirname -- "$0")" && pwd)"
node "$repo_root/install.cjs" "$@"
