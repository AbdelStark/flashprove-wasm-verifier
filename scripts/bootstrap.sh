#!/usr/bin/env bash
# Downloads the pinned wasi-sdk and Wasmtime for this machine into .toolchain/, checks each archive
# against toolchain.lock before unpacking, and prints the versions. Idempotent.
source "$(dirname "$0")/lib.sh"
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) sdk=X86_64_LINUX sdk_arch=x86_64-linux wt=X86_64_LINUX wt_arch=x86_64-linux ;;
  Linux-aarch64 | Linux-arm64) sdk=ARM64_LINUX sdk_arch=arm64-linux wt=AARCH64_LINUX wt_arch=aarch64-linux ;;
  Darwin-arm64) sdk=ARM64_MACOS sdk_arch=arm64-macos wt=AARCH64_MACOS wt_arch=aarch64-macos ;;
  Darwin-x86_64) sdk=X86_64_MACOS sdk_arch=x86_64-macos wt=X86_64_MACOS wt_arch=x86_64-macos ;;
  *) echo "bootstrap: no pinned toolchain for $(uname -s) $(uname -m)" >&2; exit 2 ;;
esac
tc=$ROOT/.toolchain
mkdir -p "$tc/downloads"
fetch() { # fetch <url> <file> <sha256>
  local f=$tc/downloads/$2
  if [[ ! -f $f ]]; then
    curl -fsSL --retry 3 -o "$f.part" "$1"
    mv "$f.part" "$f"
  fi
  [[ $(sha256 "$f" | cut -d' ' -f1) == "$3" ]] || { rm -f "$f"; echo "bootstrap: $2 does not match toolchain.lock" >&2; exit 1; }
}
v=$(lock toolchain.lock WASI_SDK_VERSION)
name=wasi-sdk-$v-$sdk_arch.tar.gz
if [[ ! -x $tc/wasi-sdk/bin/clang++ ]]; then
  fetch "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${v%%.*}/$name" "$name" "$(lock toolchain.lock "WASI_SDK_SHA256_$sdk")"
  rm -rf "$tc/wasi-sdk" && mkdir -p "$tc/wasi-sdk"
  tar -xzf "$tc/downloads/$name" -C "$tc/wasi-sdk" --strip-components 1
fi
v=$(lock toolchain.lock WASMTIME_VERSION)
name=wasmtime-v$v-$wt_arch.tar.xz
if [[ ! -x $tc/wasmtime/wasmtime ]]; then
  fetch "https://github.com/bytecodealliance/wasmtime/releases/download/v$v/$name" "$name" "$(lock toolchain.lock "WASMTIME_SHA256_$wt")"
  rm -rf "$tc/wasmtime" && mkdir -p "$tc/wasmtime"
  tar -xJf "$tc/downloads/$name" -C "$tc/wasmtime" --strip-components 1
fi
echo "bootstrap: $("$tc/wasi-sdk/bin/clang++" --version | head -1)"
echo "bootstrap: $("$tc/wasmtime/wasmtime" --version)"
