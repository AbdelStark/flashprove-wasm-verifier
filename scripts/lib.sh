# Shared helpers. Sourced, not run.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
lock() { # lock <file> <KEY>: prints the value of KEY in a KEY=VALUE lock file
  local v
  v=$(sed -n "s/^$2=//p" "$ROOT/$1")
  [[ -n $v ]] || { echo "$1: no $2" >&2; exit 2; }
  printf '%s' "$v"
}
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
