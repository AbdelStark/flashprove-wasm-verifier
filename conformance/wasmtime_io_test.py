"""Exercise audited imports through actual wasm calls and the serving module."""

from pathlib import Path
import re
import struct
import unittest

import wasmtime

from host.wasmtime.wasi import (
    BADF, FD_READ, FD_SEEK, FD_STAT, FD_WRITE, INVAL, NOTCAPABLE, NOTDIR, NOTSUP, PREVIEW1,
    GuestExit, GuestFault, Wasi,
)


ROOT = Path(__file__).resolve().parents[1]


class RestrictedIoTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        config = wasmtime.Config()
        config.wasm_exceptions = True
        cls.engine = wasmtime.Engine(config)

    def instantiate(self, host, module):
        linker = wasmtime.Linker(self.engine)
        host.link(linker, module)
        store = wasmtime.Store(self.engine)
        return store, linker.instantiate(store, module).exports(store)

    def probe(self, host, signatures, pages=1):
        imports = []
        wrappers = []
        for name, types in signatures.items():
            params = " ".join(types)
            arguments = " ".join(f"local.get {i}" for i in range(len(types)))
            imports.append(f'(import "{PREVIEW1}" "{name}" (func ${name} (param {params}) (result i32)))')
            wrappers.append(f'(func (export "{name}") (param {params}) (result i32) {arguments} call ${name})')
        wat = "(module " + "\n".join(imports + [f'(memory (export "memory") {pages})'] + wrappers) + ")"
        return self.instantiate(host, wasmtime.Module(self.engine, wat))

    def test_argument_layout_and_empty_environment(self):
        args = (b"cp_verify", b"a b", b"\xc3\xa9", b"")
        host = Wasi(args, {})
        store, inst = self.probe(host, {
            "args_sizes_get": ("i32", "i32"), "args_get": ("i32", "i32"),
            "environ_sizes_get": ("i32", "i32"), "environ_get": ("i32", "i32"),
        })
        memory = inst["memory"]
        self.assertEqual(inst["args_sizes_get"](store, 0, 4), 0)
        self.assertEqual(struct.unpack("<II", memory.read(store, 0, 8)), (4, 18))
        self.assertEqual(inst["args_get"](store, 8, 64), 0)
        self.assertEqual(struct.unpack("<IIII", memory.read(store, 8, 24)), (64, 74, 78, 81))
        self.assertEqual(bytes(memory.read(store, 64, 82)), b"cp_verify\0a b\0\xc3\xa9\0\0")
        memory.write(store, b"sentinel", 100)
        self.assertEqual(inst["environ_get"](store, 100, 100), 0)
        self.assertEqual(bytes(memory.read(store, 100, 108)), b"sentinel")
        self.assertEqual(inst["environ_sizes_get"](store, 100, 104), 0)
        self.assertEqual(bytes(memory.read(store, 100, 108)), bytes(8))

    def test_invalid_pointers_and_unsigned_iovec_overflow(self):
        host = Wasi([b"cp_verify"], {})
        store, inst = self.probe(host, {
            "args_sizes_get": ("i32", "i32"), "fd_write": ("i32",) * 4,
        }, pages=64)
        with self.assertRaisesRegex(GuestFault, "memory range"):
            inst["args_sizes_get"](store, 0, (1 << 22) - 2)
        self.assertEqual(bytes(inst["memory"].read(store, 0, 4)), bytes(4))
        with self.assertRaisesRegex(GuestFault, "memory range"):
            inst["fd_write"](store, 1, -4, 2, 12)
        inst["memory"].write(store, struct.pack("<II", 0, 1 << 22) * 1024, 0)
        with self.assertRaisesRegex(GuestFault, "length overflow"):
            inst["fd_write"](store, 1, 0, 1024, 8192)
        self.assertEqual(host.stdout, b"")

    def test_denied_capabilities(self):
        host = Wasi([], {b"/proof": b"data"})
        store, inst = self.probe(host, {
            "random_get": ("i32", "i32"),
            "clock_time_get": ("i32", "i64", "i32"),
            "path_open": ("i32",) * 5 + ("i64", "i64", "i32", "i32"),
        })
        memory = inst["memory"]
        memory.write(store, b"unchanged", 100)
        self.assertEqual(inst["random_get"](store, 100, 9), NOTCAPABLE)
        self.assertEqual(inst["clock_time_get"](store, 0, 0, 100), NOTSUP)
        self.assertEqual(bytes(memory.read(store, 100, 109)), b"unchanged")
        memory.write(store, b"proof../secret", 0)
        self.assertEqual(inst["path_open"](store, 3, 0, 0, 5, 0, FD_WRITE, 0, 0, 120), NOTCAPABLE)
        self.assertEqual(inst["path_open"](store, 3, 0, 5, 9, 0, FD_READ, 0, 0, 120), NOTCAPABLE)
        self.assertEqual(set(host.fds), {0, 1, 2, 3})
        with self.assertRaisesRegex(GuestFault, "unaudited WASI import"):
            self.probe(host, {"sock_accept": ("i32", "i32", "i32")})
        with self.assertRaisesRegex(GuestFault, "unaudited WASI import"):
            self.probe(host, {"random_get": ("i64", "i32")})

    def test_file_offsets_and_descriptor_lifetime(self):
        host = Wasi([], {b"/d/proof": b"abcdef"})
        store, inst = self.probe(host, {
            "path_open": ("i32",) * 5 + ("i64", "i64", "i32", "i32"),
            "fd_seek": ("i32", "i64", "i32", "i32"), "fd_read": ("i32",) * 4,
            "fd_pread": ("i32", "i32", "i32", "i64", "i32"), "fd_close": ("i32",),
        })
        memory = inst["memory"]
        memory.write(store, b"d/../d/proof/..", 0)
        rights = FD_READ | FD_SEEK | FD_STAT
        self.assertEqual(inst["path_open"](store, 3, 1, 0, 15, 0, rights, 0, 0, 16), NOTDIR)
        self.assertEqual(inst["path_open"](store, 3, 1, 0, 12, 0, rights, 0, 0, 16), 0)
        first, = struct.unpack("<I", memory.read(store, 16, 20))
        self.assertEqual(inst["path_open"](store, 3, 1, 0, 12, 0, rights, 0, 0, 16), 0)
        second, = struct.unpack("<I", memory.read(store, 16, 20))
        memory.write(store, struct.pack("<IIII", 80, 1, 81, 2), 32)
        self.assertEqual(inst["fd_pread"](store, first, 32, 2, 2, 20), 0)
        self.assertEqual(bytes(memory.read(store, 80, 83)), b"cde")
        self.assertEqual(inst["fd_read"](store, first, 32, 2, 20), 0)
        self.assertEqual(bytes(memory.read(store, 80, 83)), b"abc")
        self.assertEqual(inst["fd_read"](store, first, 32, 2, 20), 0)
        self.assertEqual(bytes(memory.read(store, 80, 83)), b"def")
        self.assertEqual(inst["fd_read"](store, second, 32, 2, 20), 0)
        self.assertEqual(bytes(memory.read(store, 80, 83)), b"abc")
        self.assertEqual(inst["fd_seek"](store, first, (1 << 63) - 1, 1, 24), INVAL)
        self.assertEqual(inst["fd_pread"](store, first, 32, 2, -1, 20), INVAL)
        self.assertEqual(inst["fd_read"](store, first, 32, 2, 20), 0)
        self.assertEqual(bytes(memory.read(store, 20, 24)), bytes(4))
        self.assertEqual(inst["fd_close"](store, first), 0)
        self.assertEqual(inst["fd_read"](store, first, 32, 2, 20), BADF)

    def test_output_limit_rejects_whole_write(self):
        host = Wasi([], {}, output_limit=3)
        store, inst = self.probe(host, {"fd_write": ("i32",) * 4})
        memory = inst["memory"]
        memory.write(store, struct.pack("<IIII", 64, 2, 66, 2), 0)
        memory.write(store, b"abcd", 64)
        with self.assertRaisesRegex(GuestFault, "output limit"):
            inst["fd_write"](store, 1, 0, 2, 16)
        self.assertEqual(host.stdout, b"")

    def test_serving_plan_with_two_monotonic_clocks(self):
        module = wasmtime.Module.from_file(self.engine, ROOT / "build/wasm/cp_verify.wasm")
        config = ROOT / ".upstream/FlashProve/examples/accepted-proof/config"
        files = {f"/config/{name}".encode(): (config / name).read_bytes()
                 for name in ("policy.txt", "KL.bin", "layout.txt")}
        results = []
        wrong = {**files, b"/config/policy.txt": re.sub(rb"(?m)^tsilu0 [0-9]+$", b"tsilu0 0", files[b"/config/policy.txt"])}
        for snapshot, status, ending in ((files, 4, b"PLAN ONLY: no proof was checked"),
                                         (wrong, 1, b"NO: table-digest-silu")):
            results.clear()
            for step in (1000, 1_000_000_000):
                clock = iter(range(step, 10_000 * step, step))
                times = []

                def tick():
                    now = next(clock)
                    times.append(now)
                    return now

                host = Wasi([b"cp_verify", b"-plan", b"accounting", b"/config", b"128"], snapshot, clock=tick)
                store, inst = self.instantiate(host, module)
                with self.assertRaises(GuestExit) as exit_:
                    inst["_start"](store)
                self.assertEqual(exit_.exception.status, status)
                self.assertGreater(len(times), 0)
                self.assertEqual(host.stdout.splitlines()[-1], ending)
                results.append((bytes(host.stdout), bytes(host.stderr)))
            self.assertEqual(*results)


if __name__ == "__main__":
    unittest.main()
