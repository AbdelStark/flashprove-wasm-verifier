# 0007. CLI disk capabilities and read order

- Status: Accepted
- Requirements: R-SYS-1, R-MEM-2, R-STG-2

The CLI binds the file and directory operands in upstream's call forms. The guest keeps its original arguments and controls the order of file operations. A metadata query can pin a regular file and return its length before any bytes are read. The first open reads through that pin, confirms the metadata before and after reading and caches the bytes or ordinary error. This preserves the verifier's length check before it tries to open a proof. Replay uses the same input cache.

The disk adapter uses Linux `O_PATH` and requires actual procfs at `/proc/self/fd`. Explicit file and directory operands can resolve caller-selected symlinks. The fixed children of configuration and key directories, including the decimal leaf selected by the guest, are opened relative to retained directory descriptors with symlink following disabled. The adapter checks the opened inode before obtaining readable access.

The supported disk-acquisition platforms are Linux x64 and arm64 with procfs. Other hosts can still use the in-memory namespace. Native may follow a symlink in a guest-selected descendant, or read a nonregular input. The scoped adapter refuses those accesses. Native can also distinguish a relative operand from an absolute operand that becomes the same path at the root WASI import. If such operands refer to different disk paths, the adapter refuses at the first ambiguous access. These capability boundaries can change the native rejection or replace a pass with a host refusal. Invalid options still reach upstream validation before any disk access.

Run `make test check scoped-disk-test`. Verify both streams for the four native planning forms, option-like or parent-relative paths, invalid options, a missing selected leaf and a wrong-length request beside a missing proof. Scoped negative tests check symlinks, changing files, retained byte limits and ordinary errors.
