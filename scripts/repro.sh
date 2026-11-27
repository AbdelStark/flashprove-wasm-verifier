#!/usr/bin/env bash
# Build the serving module in two clean roots at different absolute paths from the committed tree
# and the same pins, then compare the bytes (RFC-0010). Writes build/repro.json.
# Reuses only hash-checked inputs: toolchain archives (bootstrap re-hashes them against
# toolchain.lock) and the upstream clone (fetch-upstream re-checks the commit and SHA256SUMS).
source "$(dirname "$0")/lib.sh"
set -euo pipefail
base=$(mktemp -d "${TMPDIR:-/tmp}/fpv-repro.XXXXXX")
trap 'rm -rf -- "$base"' EXIT
roots=("$base/a" "$base/b/a/longer/path/to/root")
commit=$(git -C "$ROOT" rev-parse HEAD)
for root in "${roots[@]}"; do
  mkdir -p "$root/.toolchain/downloads" "$root/.upstream"
  git -C "$ROOT" archive HEAD | tar -x -C "$root"
  cp "$ROOT"/.toolchain/downloads/*.tar.* "$root/.toolchain/downloads/" 2>/dev/null || true
  git clone -q "$ROOT/.upstream/FlashProve" "$root/.upstream/FlashProve"
  echo "repro: building $commit in $root"
  make -C "$root" --no-print-directory bootstrap upstream build >"$root.log" 2>&1 || { tail -40 "$root.log" >&2; exit 1; }
done
mkdir -p "$ROOT/build"
python3 -B "$ROOT/scripts/compare_builds.py" "${roots[@]}" "$ROOT/build/repro.json"
python3 -B - "$ROOT/build/repro.json" "$commit" "$ROOT" <<'PY'
import json, sys
path, commit, root = sys.argv[1], sys.argv[2], sys.argv[3]
record = json.load(open(path))
record["commit"] = commit
for key in ("FLASHPROVE_COMMIT", "WASI_SDK_VERSION"):
    for lock in ("upstream.lock", "toolchain.lock"):
        for line in open(f"{root}/{lock}"):
            if line.startswith(key + "="):
                record[key] = line.split("=", 1)[1].strip()
json.dump(record, open(path, "w"), indent=2, sort_keys=True)
PY
