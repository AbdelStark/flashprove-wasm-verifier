# host

The TypeScript host (M2): it loads the module, serves the call's files from memory (R-SYS-1), runs one instance per stage with fork by replay (R-STG-2), enforces size and memory limits (R-MEM-2) and maps every abnormal ending to `NOT CHECKED` (R-EQ-4).

Two front ends share it:

- `fpv`, a Node command with `cp_verify`'s arguments, output and exit codes (R-API-1)
- `verify(files, args)` for browsers and servers, run in a Web Worker in the browser (R-API-2), with `checkAcceptance()` beside it (R-API-3)
