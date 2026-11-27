#!/usr/bin/env bash
# rehearse-pin.sh <commit>: rehearse moving upstream.lock to <commit> in an isolated worktree.
# Builds and audits the module at the candidate pin, compares its source digest with the current
# pin and lists every changed path that the verifier build or the fixtures read. Writes
# build/rehearsal-<short>.json. The full gates run in CI on a branch that carries only the lock change.
source "$(dirname "$0")/lib.sh"
candidate=${1:?usage: rehearse-pin.sh <40-hex upstream commit>}
[[ $candidate =~ ^[0-9a-f]{40}$ ]] || { echo "rehearse-pin: expected a full commit hash" >&2; exit 2; }
current=$(lock upstream.lock FLASHPROVE_COMMIT)
short=${candidate:0:12}
work=$ROOT/build/rehearsal/$short
git -C "$ROOT" worktree remove --force "$work" 2>/dev/null || true
git -C "$ROOT" worktree add -q --detach "$work" HEAD
trap 'git -C "$ROOT" worktree remove --force "$work"' EXIT
sed -i.bak "s/^FLASHPROVE_COMMIT=.*/FLASHPROVE_COMMIT=$candidate/" "$work/upstream.lock" && rm "$work/upstream.lock.bak"
mkdir -p "$work/.toolchain/downloads"
cp "$ROOT"/.toolchain/downloads/*.tar.* "$work/.toolchain/downloads/" 2>/dev/null || true
git clone -q "$ROOT/.upstream/FlashProve" "$work/.upstream/FlashProve"
make -C "$work" --no-print-directory bootstrap upstream check build >"$work.log" 2>&1 || { tail -30 "$work.log" >&2; exit 1; }
changed=$(git -C "$work/.upstream/FlashProve" diff --name-only "$current" "$candidate")
inputs=$(printf '%s\n' "$changed" | grep -E '^(verifier/|blocks/|prover/[^/]+/plan_rounds\.h$|prover/hiding/token_plan\.h$|examples/)' || true)
python3 -B - "$ROOT/build/rehearsal-$short.json" "$current" "$candidate" "$(cat "$ROOT/build/wasm/source.sha256" 2>/dev/null)" \
  "$(cat "$work/build/wasm/source.sha256")" "$(cat "$work/build/wasm/cp_verify.wasm.sha256")" "$changed" "$inputs" <<'PY'
import json, sys
path, current, candidate, old_source, new_source, module, changed, inputs = sys.argv[1:]
record = {"schema": 1, "currentCommit": current, "candidateCommit": candidate,
          "currentSourceSha256": old_source or None, "candidateSourceSha256": new_source,
          "candidateModuleSha256": module, "changedPaths": [p for p in changed.split("\n") if p],
          "changedVerifierInputs": [p for p in inputs.split("\n") if p]}
record["sourceUnchanged"] = old_source == new_source
json.dump(record, open(path, "w"), indent=2, sort_keys=True)
print(f"rehearsal: {candidate[:12]} audited; {len(record['changedPaths'])} changed paths, "
      f"{len(record['changedVerifierInputs'])} verifier inputs; source digest "
      f"{'unchanged' if record['sourceUnchanged'] else 'CHANGED'}")
PY
