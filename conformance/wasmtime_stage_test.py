"""Exercise stage transport and failure through an actual Wasmtime guest."""

from pathlib import Path
from tempfile import TemporaryDirectory
from types import MappingProxyType
import unittest

import wasmtime

from host.wasmtime.stages import FAILED, PartRunner, ProcessHost, Result
from host.wasmtime.wasi import GuestFault


ROOT = Path(__file__).resolve().parents[1]
PART_ARGS = (b"cp_verify", b"-key")


def program(child_end, parent_checks, status):
    # Each invocation reaches the same fork after a memory write and a stdout write.
    return f'''(module
      (import "fpv_port" "abi_version" (func $version (result i32)))
      (import "fpv_port" "pipe" (func $pipe (param i32) (result i32)))
      (import "fpv_port" "fork" (func $fork (result i32)))
      (import "fpv_port" "dup2" (func $dup2 (param i32 i32) (result i32)))
      (import "fpv_port" "waitpid" (func $wait (param i32 i32 i32) (result i32)))
      (import "wasi_snapshot_preview1" "fd_close" (func $close (param i32) (result i32)))
      (import "wasi_snapshot_preview1" "fd_write" (func $write (param i32 i32 i32 i32) (result i32)))
      (import "wasi_snapshot_preview1" "fd_read" (func $read (param i32 i32 i32 i32) (result i32)))
      (import "wasi_snapshot_preview1" "proc_exit" (func $exit (param i32)))
      (memory (export "memory") 1)
      (data (i32.const 100) "pabce")
      (func $assert (param i32) local.get 0 i32.eqz if unreachable end)
      (func (export "_start") (local $pid i32)
        i32.const 400 i32.load i32.eqz call $assert
        i32.const 400 i32.const 1 i32.store
        call $version i32.const 1 i32.eq call $assert
        i32.const 16 i32.const 100 i32.store
        i32.const 20 i32.const 1 i32.store
        i32.const 1 i32.const 16 i32.const 1 i32.const 32 call $write i32.eqz call $assert
        i32.const 0 call $pipe i32.eqz call $assert
        call $fork local.tee $pid i32.eqz
        if
          i32.const 0 i32.load call $close i32.eqz call $assert
          i32.const 4 i32.load i32.const 1 call $dup2 i32.const 1 i32.eq call $assert
          i32.const 4 i32.load call $close i32.eqz call $assert
          i32.const 16 i32.const 101 i32.store
          i32.const 20 i32.const 3 i32.store
          i32.const 1 i32.const 16 i32.const 1 i32.const 32 call $write i32.eqz call $assert
          i32.const 16 i32.const 104 i32.store
          i32.const 20 i32.const 1 i32.store
          i32.const 2 i32.const 16 i32.const 1 i32.const 32 call $write i32.eqz call $assert
          {child_end}
          unreachable
        end
        i32.const 4 i32.load call $close i32.eqz call $assert
        i32.const 16 i32.const 200 i32.store
        i32.const 20 i32.const 2 i32.store
        {parent_checks}
        i32.const 0 i32.load call $close i32.eqz call $assert
        local.get $pid i32.const 40 i32.const 0 call $wait local.get $pid i32.eq call $assert
        i32.const 40 i32.load i32.const {status} i32.eq call $assert
        i32.const 3 call $exit))'''


def read_pipe(size):
    return f'''
        i32.const 0 i32.load i32.const 16 i32.const 1 i32.const 32 call $read i32.eqz call $assert
        i32.const 32 i32.load i32.const {size} i32.eq call $assert'''


class ChangedObservationRunner(PartRunner):
    def change(self, host):
        host.journal.add(b"changed pre-fork observation", 1)

    def start(self, host):
        if host.expected is None:
            return super().start(host)
        self.change(host)
        try:
            return super().start(host)
        except GuestFault as error:
            self.replay_error = str(error)
            raise


class ChangedFileRunner(ChangedObservationRunner):
    def change(self, host):
        host.files = MappingProxyType({(b"file",): b"changed"})


class StageTransportTest(unittest.TestCase):
    def runner(self, wat, kind=PartRunner):
        scratch = TemporaryDirectory(dir=ROOT / "build")
        self.addCleanup(scratch.cleanup)
        artifact = Path(scratch.name) / "transport.wasm"
        artifact.write_bytes(wasmtime.wat2wasm(wat))
        return kind(artifact)

    def test_fresh_child_redirect_and_short_reads(self):
        checks = (read_pipe(2) + "\n i32.const 200 i32.load16_u i32.const 25185 i32.eq call $assert"
                  + read_pipe(1) + "\n i32.const 200 i32.load8_u i32.const 99 i32.eq call $assert"
                  + read_pipe(0))
        runner = self.runner(program("i32.const 7 call $exit", checks, 7 << 8))
        self.assertEqual(runner.run(PART_ARGS, {}), Result(3, b"p", b"e"))

    def test_trap_delivers_signal_and_latches_call_failure(self):
        runner = self.runner(program("unreachable", read_pipe(0), 6))
        host = ProcessHost(runner, PART_ARGS, {})
        # The synthetic parent reports success only after seeing signal 6 and EOF.
        self.assertEqual(runner.start(host), 3)
        self.assertTrue(host.fault)
        self.assertIsNone(host.wait_word)
        self.assertEqual(runner.run(PART_ARGS, {}), Result(5, FAILED, b""))

    def test_changed_observation_refuses_before_child_branch(self):
        runner = self.runner(program("unreachable", read_pipe(0), 6), ChangedObservationRunner)
        self.assertEqual(runner.run(PART_ARGS, {}), Result(5, FAILED, b""))
        self.assertEqual(runner.replay_error, "fork replay mismatch")

    def test_changed_file_view_refuses_even_with_the_same_observations(self):
        runner = self.runner(program("unreachable", read_pipe(0), 6), ChangedFileRunner)
        self.assertEqual(runner.run(PART_ARGS, {b"/file": b"original"}), Result(5, FAILED, b""))
        self.assertEqual(runner.replay_error, "fork replay mismatch")


if __name__ == "__main__":
    unittest.main()
