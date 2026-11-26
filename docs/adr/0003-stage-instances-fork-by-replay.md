# 0003. One instance per stage, fork by deterministic replay

Status: accepted, 2026-11-26

## Context

`cpStagesRun()` forks one child process per stage (`key`, `leaf`, `request`), reads each child's output through a pipe and merges the results. `runStage()` runs once per process, keeps state in file-scope variables and exits through `refuse()`. WebAssembly has no `fork()`. A module cannot copy its own memory into a new instance.

## Decision

Give every stage a fresh instance. Implement `fork()` by replay: the host starts a new instance with the same argument vector and the same in-memory files, and tells it which child it is. The new instance runs `main()` again, deterministically, up to the same `fork()`, which returns 0 there. It then runs the child's path. Its standard output fills the pipe the parent reads, and its exit status, or a trap mapped to a signal status, is what `waitpid()` returns.

## Why replay is sound here

Everything before the fork is a function of the arguments and the files: argument parsing, file reads, parsing. No clock, randomness or environment value affects that state. The port records a digest of the argument vector and of every file read before the fork, in both instances, and the host compares them. A mismatch ends the call in `NOT CHECKED`.

## Consequences

- Upstream's process isolation is kept: a stage cannot see another stage's memory, and a crash in one stage is a failed stage, not a corrupted parent.
- The parent's work before the fork runs once per stage plus once in the parent: reading and parsing about 25 MB at full size. M2 measures it against the stages' own time.
- No change to `cpStagesRun()` is needed: `fork`, `pipe`, `dup2`, `read`, `close`, `waitpid` and `exit` are served by the port and the host.
