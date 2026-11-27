"""Release signing, verification and publication retry (#48). Needs OpenSSL 3 or later (OPENSSL)."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import release  # noqa: E402


def openssl_ok():
    try:
        output = subprocess.run([release.OPENSSL, "version"], capture_output=True, text=True).stdout.split()
        return output[0] == "OpenSSL" and int(output[1].split(".")[0]) >= 3
    except (OSError, IndexError, ValueError):
        return False


@unittest.skipUnless(openssl_ok() or os.environ.get("REQUIRE_OPENSSL"), "OpenSSL 3 or later is not available")
class Release(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.dir = self.tmp / "stage"
        (self.dir / "notices").mkdir(parents=True)
        (self.dir / "cp_verify.wasm").write_bytes(b"\0asm\1\0\0\0module")
        (self.dir / "notices/NOTICE").write_text("notice\n")
        (self.dir / "flashprove-wasm-verifier-1.0.0.tgz").write_bytes(b"package")
        manifest = release.manifest_for(self.dir, "1.0.0", "c" * 40)
        (self.dir / release.MANIFEST).write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
        self.key, self.public = self.tmp / "key.pem", self.tmp / "public.pem"
        subprocess.run([release.OPENSSL, "genpkey", "-algorithm", "ed25519", "-out", str(self.key)], check=True, capture_output=True)
        subprocess.run([release.OPENSSL, "pkey", "-in", str(self.key), "-pubout", "-out", str(self.public)], check=True, capture_output=True)
        self.fingerprint = release.sign(self.dir, self.key)

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_manifest_excludes_itself_and_lists_final_bytes(self):
        manifest = release.verify(self.dir, self.public, self.fingerprint)
        self.assertEqual([a["path"] for a in manifest["artifacts"]],
                         ["cp_verify.wasm", "flashprove-wasm-verifier-1.0.0.tgz", "notices/NOTICE"])
        self.assertEqual(manifest["abi"], 1)
        self.assertRegex(manifest["upstreamLockSha256"], "^[0-9a-f]{64}$")

    def test_modified_manifest_or_asset_is_rejected(self):
        original = (self.dir / release.MANIFEST).read_bytes()
        (self.dir / release.MANIFEST).write_bytes(original.replace(b'"1.0.0"', b'"1.0.1"'))
        with self.assertRaisesRegex(release.ReleaseError, "signature does not verify"):
            release.verify(self.dir, self.public)
        (self.dir / release.MANIFEST).write_bytes(original)
        (self.dir / "cp_verify.wasm").write_bytes(b"\0asm\1\0\0\0modulf")
        with self.assertRaisesRegex(release.ReleaseError, "cp_verify.wasm does not match"):
            release.verify(self.dir, self.public)

    def test_unlisted_file_wrong_key_and_fingerprint(self):
        (self.dir / "extra.bin").write_bytes(b"x")
        with self.assertRaisesRegex(release.ReleaseError, "not in the manifest: extra.bin"):
            release.verify(self.dir, self.public)
        (self.dir / "extra.bin").unlink()
        other = self.tmp / "other.pem"
        subprocess.run([release.OPENSSL, "genpkey", "-algorithm", "ed25519", "-out", str(self.tmp / "k2.pem")], check=True, capture_output=True)
        subprocess.run([release.OPENSSL, "pkey", "-in", str(self.tmp / "k2.pem"), "-pubout", "-out", str(other)], check=True, capture_output=True)
        with self.assertRaisesRegex(release.ReleaseError, "signature does not verify"):
            release.verify(self.dir, other)
        with self.assertRaisesRegex(release.ReleaseError, "expected fingerprint"):
            release.verify(self.dir, self.public, "0" * 64)

    def test_partial_publication_resumes_only_with_identical_bytes(self):
        store = release.DirectoryStore(self.tmp / "store")
        with self.assertRaisesRegex(release.ReleaseError, "interrupted after 2 uploads"):
            release.publish(self.dir, store, stop_after=2)
        counts = release.publish(self.dir, store)
        self.assertEqual(counts, {"uploaded": 3, "kept": 2, "assets": 5})
        self.assertEqual(release.publish(self.dir, store), {"uploaded": 0, "kept": 5, "assets": 5})
        published = self.tmp / "published"
        shutil.copytree(self.tmp / "store", published)
        release.verify(published, self.public, self.fingerprint)

    def test_download_restores_nested_paths(self):
        store = release.DirectoryStore(self.tmp / "store")
        release.publish(self.dir, store)
        out = self.tmp / "fetched"
        self.assertEqual(release.download(store, out), 5)
        release.verify(out, self.public, self.fingerprint)

    def test_differing_published_asset_stops_publication(self):
        store = release.DirectoryStore(self.tmp / "store")
        store.put("cp_verify.wasm", b"other bytes")
        with self.assertRaisesRegex(release.ReleaseError, "differs from the staged bytes"):
            release.publish(self.dir, store)
        self.assertIsNone(store.get(release.MANIFEST))

    def test_demo_archive_is_byte_stable(self):
        source = self.tmp / "demo"
        (source / "fixtures").mkdir(parents=True)
        (source / "index.html").write_text("<!doctype html>")
        (source / "fixtures/a.bin").write_bytes(b"a")
        first, second = self.tmp / "one.tar.gz", self.tmp / "two.tar.gz"
        release.deterministic_tar(source, first)
        os.utime(source / "index.html", (0, 1_000_000))
        release.deterministic_tar(source, second)
        self.assertEqual(first.read_bytes(), second.read_bytes())


if __name__ == "__main__":
    unittest.main()
