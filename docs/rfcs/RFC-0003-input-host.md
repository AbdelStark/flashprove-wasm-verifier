# RFC-0003: Expose immutable input files through a restricted host

- Status: Accepted
- Authors: @AbdelStark
- Created: 2026-11-26
- Target milestone: M1, M2

## Summary

Expose a read-only virtual namespace to the verifier and let upstream control the order of argument validation and file opens. Keep the same snapshot for parent and child.

## Motivation

The parent reads configuration and selected file data before it forks. Eager file loading or a second host-side proof parser can change validation order and expose files outside the call. R-SYS-1 and R-STG-2 require controlled, repeatable observations.

## Goals

- Match native missing, unreadable and truncated-file precedence within the supported namespace.
- Verify that input changes during a run cannot change a replay.
- Expose no ambient guest capabilities.

## Non-Goals

- A general-purpose WASI implementation or host filesystem emulation.
- Following guest-generated paths outside explicitly allowed roots.

## Proposed Design

```ts
type FileStat = Readonly<{kind: "file" | "directory"; bytes: number}>;
type Lookup =
  | Readonly<{kind: "file"; bytes: Uint8Array}>
  | Readonly<{kind: "directory"}>
  | Readonly<{kind: "error"; errno: number}>;
interface CallNamespace {
  lookup(path: string): Lookup;
}
```

Copy library maps, derive virtual directories and reject file/directory collisions. Keys are absolute UTF-8 paths with no empty components, dot segments, trailing slash or NUL, and no collisions after encoding. Reject unpaired UTF-16 surrogates and shared or detached input buffers at API admission. Resolve guest path operands with POSIX slash, dot and dot-dot behavior inside the virtual namespace. Resolve intermediate components before moving to the next one. A regular file in a directory position gets `ENOTDIR`. Root cannot escape. Preserve original argv bytes and supply the permitted path resolution semantics through WASI.

The CLI selects candidate path capabilities by upstream's positional call forms, with native mode validation still in the guest. Whole calls expose the named request, token and proof paths and the public-key root's `key.bin` and `leaf/<decimal>.bin`. Part and planning forms expose the explicit files and the mode's documented config paths. Only `policy.txt`, `KL.bin` and `layout.txt` are available under a config root. Mirror forms from the pinned `cpPlanMain`, including optional path operands. An option-like positional value is a name when upstream treats it as one. The adapter must not read or fail before upstream's first corresponding syscall. Tests exercise options preceding file paths.

On first access, admit a regular disk file through the scoped capability, read no more than the declared limit plus one byte, and cache the bytes or error. Use one file handle for status and read. Reject a changing file when identity, length or metadata change across acquisition. Resolve explicit caller-selected roots at acquisition and exclude symlinks in guest-selected descendants. Obtain bytes through a confined traversal or screened stable copy that cannot race into another root. A platform that cannot enforce the boundary refuses acquisition. Store only capped snapshots and never resolve a file on disk again during a replay.

Every instance owns cursors and descriptor state. An open starts at offset zero, read advances by bytes returned, seeking checks signed arithmetic and limits, and missing paths and closed handles return the appropriate WASI error. Pipe bindings follow RFC-0004. Allow only the imported WASI Preview 1 surface needed for arguments, descriptors, file lookup, monotonic time and process exit. Span checks use bounds-safe arithmetic before accessing guest memory. Unknown or disallowed capabilities cannot return usable data. The clock is diagnostic only. The MMU and Linux process shims are listed in the audit.

## Alternatives Considered

- Preload an entire caller directory. It widens read scope and can move errors before argument parsing.
- Decode the proof header in the host to find the leaf. The guest already does so and has the authoritative parsing order.
- Pass host directories directly to the guest. That changes the file and symlink trust boundary.

## Drawbacks

- The CLI snapshots data on first access. Callers must provide stable public inputs.
- Confinement can refuse layouts that the native executable reads from disk.

## Migration / Rollout

M1 part-calls use a bounded staged fixture namespace for Wasmtime. M2 enables the shared TypeScript namespace and CLI acquisition adapter. No product output derives from an independent implementation of file formats.

## Testing Strategy

Test per-descriptor offsets, dot segments, invalid ranges, read-only behavior and guest-selected symlink escape. Test native exit precedence when a wrong-length request and missing proof are supplied together. Test a missing selected leaf, missing option values, original argv preservation and mutation after the parent acquires a file.

## Open Questions

None. If a new runtime cannot enforce the boundary, its adapter fails the release gate.

## References

[Call snapshots](../spec/03-data-model.md#call-snapshot) · [System requirements](../../SPEC.md#48-system-calls) · [Trust boundaries](../spec/06-security.md#trust-boundaries)
