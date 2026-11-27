# Toolchain notices

The module links code from wasi-sdk 34 (`toolchain.lock`). Its archive ships no license files, so the texts that apply are kept here and shipped with every binary artifact.

- `wasi-libc/`: wasi-libc at tag `wasi-sdk-34`, commit `2e6fb9d8ee0cdf9e431fbcabe8af3115de000a13` (https://github.com/WebAssembly/wasi-libc). `LICENSE` lists its parts. `musl-COPYRIGHT` (MIT) and `cloudlibc-LICENSE` (BSD-2-Clause) are the notices of the two third-party parts that the module uses. dlmalloc is CC0.
- libc++, libc++abi and compiler-rt from LLVM are under Apache-2.0 with LLVM Exceptions (`wasi-libc/LICENSE-APACHE-LLVM`). The exception waives attribution for compiled forms; the text is shipped anyway.

FlashProve's own NOTICE, LICENSE, THIRD_PARTY.md and licenses/ come from the pinned upstream checkout at package time (see the repository NOTICE).
