#!/usr/bin/env bash
# Fetch the Bend verifier at the bench.lock commit into build/bench/bend and build its standalone
# command with its own pinned toolchain. Prints the path of the executable.
source "$(dirname "$0")/lib.sh"
repo=$(lock bench.lock BEND_VERIFIER_REPO)
commit=$(lock bench.lock BEND_VERIFIER_COMMIT)
dir=$ROOT/build/bench/bend
if [[ ! -d $dir/.git ]]; then
  mkdir -p "$dir"
  git -C "$dir" init -q
  git -C "$dir" remote add origin "$repo"
fi
if [[ $(git -C "$dir" rev-parse -q --verify HEAD 2>/dev/null || true) != "$commit" ]]; then
  git -C "$dir" fetch -q --depth 1 origin "$commit"
  git -C "$dir" -c advice.detachedHead=false checkout -q --force "$commit"
fi
[[ $(git -C "$dir" rev-parse HEAD) == "$commit" ]] || { echo "bench: Bend verifier is not at $commit" >&2; exit 1; }
make -C "$dir" --no-print-directory bootstrap upstream standalone >&2
echo "$dir/build/verify-bend"
