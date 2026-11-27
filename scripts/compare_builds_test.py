"""The reproducibility comparison fails on any changed byte or provenance digest."""
import hashlib
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from compare_builds import compare  # noqa: E402


def build(root, module, source="a" * 64, port="b" * 64, recorded=None):
    wasm = pathlib.Path(root) / "build" / "wasm"
    wasm.mkdir(parents=True)
    (wasm / "cp_verify.wasm").write_bytes(module)
    (wasm / "cp_verify.wasm.sha256").write_text((recorded or hashlib.sha256(module).hexdigest()) + "\n")
    (wasm / "source.sha256").write_text(source + "\n")
    (wasm / "port.sha256").write_text(port + "\n")


class Compare(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.a, self.b = (pathlib.Path(self.dir.name) / name for name in ("a", "nested/b"))

    def tearDown(self):
        self.dir.cleanup()

    def test_identical(self):
        build(self.a, b"\0asm module")
        build(self.b, b"\0asm module")
        record, problems = compare(self.a, self.b)
        self.assertEqual(problems, [])
        self.assertTrue(record["identical"])
        self.assertEqual(record["moduleSha256"], hashlib.sha256(b"\0asm module").hexdigest())

    def test_changed_byte(self):
        build(self.a, b"\0asm module")
        build(self.b, b"\0asm modulf")
        record, problems = compare(self.a, self.b)
        self.assertFalse(record["identical"])
        self.assertIn("first difference at byte 10", problems[0])

    def test_truncated_module_and_provenance(self):
        build(self.a, b"\0asm module", port="c" * 64)
        build(self.b, b"\0asm modul")
        _, problems = compare(self.a, self.b)
        self.assertTrue(any("first difference at byte 10" in p for p in problems))
        self.assertTrue(any("port digests differ" in p for p in problems))

    def test_stale_checksum_and_missing_file(self):
        build(self.a, b"\0asm module", recorded="0" * 64)
        self.b.mkdir(parents=True)
        _, problems = compare(self.a, self.b)
        self.assertTrue(any("bytes hash to" in p for p in problems))
        self.assertTrue(any("missing cp_verify.wasm" in p for p in problems))


if __name__ == "__main__":
    unittest.main()
