# 0004. Use 64-bit file offsets on wasm32

Status: accepted, 2026-11-26

## Context

The pinned `verifier/src/vf_common.h` requires 64-bit `long` and `size_t` and uses `ftell` to store file lengths. Both types are 32-bit on wasm32. A header shim cannot change compiler type widths or replace the source assertion about them.

## Decision

Apply [`0001-wasm32-file-offsets.patch`](../../patches/0001-wasm32-file-offsets.patch) to a build copy. Use `fseeko` and `ftello` to read an `off_t` and assert that it is 64-bit. Check the length against `PTRDIFF_MAX` before converting to the buffer size. This keeps an oversized length from wrapping into a shorter word count and leaves room for the parallel-read block rounding. Retain the seek, whole-word read and odd-length checks. The native reference and upstream source digest use the untouched checkout.

## Evidence

`make wasm-build-test` exercises `readWords` on an in-range input and forces an offset above the guest buffer limit. C1 and C6 cover real calls with ordinary file lengths. C7 covers oversized host inputs when the resource limits are in place. The build records this patch in the port digest.
