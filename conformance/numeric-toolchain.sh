# Compiler settings shared by the C3 and C4 probes. Sourced, not run.
source "$(dirname "${BASH_SOURCE[0]}")/../scripts/wasm-toolchain.sh"

if [[ $(uname -s) != Linux || $(uname -m) != x86_64 ]]; then
  echo 'numeric conformance: requires x86_64 Linux with g++ 13 or later' >&2
  exit 2
fi
version=$(g++ -dumpfullversion)
if [[ ! $version =~ ^[0-9]+(\.[0-9]+)*$ || ${version%%.*} -lt 13 ]]; then
  echo 'numeric conformance: requires g++ 13 or later' >&2
  exit 2
fi

export LC_ALL=C
native_flags=(-std=c++17 -O2 -fno-ipa-modref -pthread -fno-fast-math -ffp-contract=off
  -DBLK_FIELD=2 -DDIGEST_WORDS=8 -DBLK_COUNT_HASH_CALLS=1
  "-I$upstream/verifier/src" "-I$upstream/blocks" "-I$upstream/prover")
