"""Check the linked C process shims under the Wasmtime host."""

from pathlib import Path
import unittest
from unittest.mock import patch

from host.wasmtime.stages import FAILED, PartRunner, ProcessHost, Result
from host.wasmtime.wasi import GuestFault


class ProcessAbiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.runner = PartRunner(Path("build/wasm-memory-probe.wasm"))

    def test_exit_status_crosses_the_c_wait_shim(self):
        self.assertEqual(self.runner.run((b"cp_verify", b"-key", b"child"), {}), Result(3, b"", b""))

    def test_invalid_pipe_and_wait_out_pointers(self):
        for mode in (b"bad-pipe-pointer", b"bad-wait-pointer"):
            with self.subTest(mode=mode):
                args = (b"cp_verify", b"-key", mode)
                with self.assertRaisesRegex(GuestFault, "guest memory range"):
                    self.runner.start(ProcessHost(self.runner, args, {}))
                self.assertEqual(self.runner.run(args, {}), Result(5, FAILED, b""))

    def test_unsupported_version_never_calls_pipe(self):
        args = (b"cp_verify", b"-key", b"child")
        calls = []

        def pipe(host, memory, pointer):
            calls.append(pointer)
            return 0

        with (patch.object(ProcessHost, "abi_version", staticmethod(lambda memory: 2)),
              patch.object(ProcessHost, "pipe", pipe)):
            self.assertEqual(self.runner.run(args, {}), Result(5, FAILED, b""))
        self.assertEqual(calls, [])
