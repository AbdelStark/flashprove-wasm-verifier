#!/usr/bin/env bash
source "$(dirname "$0")/lib.sh"

if [[ $(uname -s) != Linux || $(uname -m) != x86_64 ]]; then
  echo 'reference: requires x86_64 Linux' >&2
  exit 2
fi
version=$(g++ -dumpfullversion)
if [[ ! $version =~ ^[0-9]+(\.[0-9]+)*$ || ${version%%.*} -lt 13 ]]; then
  echo 'reference: requires g++ 13 or later' >&2
  exit 2
fi

upstream=$ROOT/.upstream/FlashProve
commit=$(lock upstream.lock FLASHPROVE_COMMIT)
out=$ROOT/build/native
export LC_ALL=C
mkdir -p "$ROOT/build"
{
  echo "reference: upstream=$commit"
  g++ --version | sed -n '1p'
  getconf GNU_LIBC_VERSION
  "$upstream/verifier/build.sh" - "$out"
  [[ $(git -C "$upstream" rev-parse HEAD) == "$commit" &&
     -z $(git -C "$upstream" status --porcelain) ]] || {
    echo 'reference: upstream checkout changed during the build' >&2
    exit 1
  }
  echo 'reference: upstream checkout is clean at the verified pin'
} | tee "$ROOT/build/native-build.log"
