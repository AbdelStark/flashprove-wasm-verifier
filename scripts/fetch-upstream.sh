#!/usr/bin/env bash
# Fetches FlashProve at the commit in upstream.lock into .upstream/FlashProve, checks the commit,
# then checks every published example against its own SHA256SUMS. Idempotent. Never edits upstream.
source "$(dirname "$0")/lib.sh"
repo=$(lock upstream.lock FLASHPROVE_REPO)
commit=$(lock upstream.lock FLASHPROVE_COMMIT)
dir=$ROOT/.upstream/FlashProve
if [[ ! -d $dir/.git ]]; then
  mkdir -p "$dir"
  git -C "$dir" init -q
  git -C "$dir" remote add origin "$repo"
fi
if [[ $(git -C "$dir" rev-parse -q --verify HEAD 2>/dev/null || true) != "$commit" ]]; then
  git -C "$dir" fetch -q --depth 1 origin "$commit"
  git -C "$dir" -c advice.detachedHead=false checkout -q --force "$commit"
fi
head=$(git -C "$dir" rev-parse HEAD)
[[ $head == "$commit" ]] || { echo "upstream: HEAD is $head, lock says $commit" >&2; exit 1; }
[[ -z $(git -C "$dir" status --porcelain) ]] || { echo "upstream: .upstream/FlashProve has local changes; it is read-only" >&2; exit 1; }
for ex in accepted-proof accepted-proof-clipped-gap full-size full-size-clipped-gap; do
  (cd "$dir/examples/$ex" && sha256 -c --quiet SHA256SUMS) || { echo "upstream: examples/$ex fails its SHA256SUMS" >&2; exit 1; }
done
echo "upstream: FlashProve $(lock upstream.lock FLASHPROVE_VERSION) at ${commit:0:12}, four examples match their SHA256SUMS"
