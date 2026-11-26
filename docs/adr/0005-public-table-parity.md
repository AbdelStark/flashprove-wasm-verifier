# 0005. Use the pinned SDK math for public tables

Status: accepted, 2026-11-26

## Context

The verifier regenerates and checks four public tables before it uses proof data. R-FP-1 requires entry-level comparison with the native oracle. A change to a quantized word can change the bound table digest.

## Decision

Use the math library supplied by the pinned wasi-sdk with the serving build's strict floating-point flags. Preserve every constructor and digest check. The test-only probe captures the actual words passed to the table digest function and still executes that function and the policy check.

## Evidence

`make conformance` compares all four published policies with GCC 13 on x86_64 Linux. It checks the table dimensions and every entry, then matches both digests to the pinned policy. An altered entry reports its table, index and the two encoded values. A changed SiLU digest is refused by the native constructor and the serving Wasm module.

The served SiLU and sigmoid profiles use the default gate scale and clamp, with clamping enabled. The served attention exponential table uses `S=12` and `rx=8`. C4 runs those exact constructors. It also compares the quantized RoPE expression at both permitted theta values, every power-of-two head width from 2 to 128, positions 0 to 1023, both trigonometric functions and all channel pairs. The allowed shorter position ranges use a prefix of that sweep. The output of a normal call, including its numerical accounting, is covered by the later differential gates.
