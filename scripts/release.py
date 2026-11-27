#!/usr/bin/env python3
"""Stage, sign, verify and publish release artifacts (RFC-0010, #48).

  release.py stage   --version V --out DIR      collect artifacts and write DIR/manifest.json
  release.py sign    --dir DIR --key KEY.pem    sign the exact manifest bytes (Ed25519, OpenSSL 3+)
  release.py verify  --dir DIR --public-key PUB.pem [--fingerprint HEX]
  release.py publish --dir DIR (--store PATH | --github-release TAG) [--stop-after N]
  release.py download --github-release TAG --out DIR

The manifest is ReleaseManifestV1 with sorted keys. It lists every artifact except itself and its
detached signature, by unique relative path, size and SHA-256 of the final bytes. Staging refuses
unless the release gates passed for this commit and their tested module is the module staged.
Publication never replaces an asset: an existing asset with the same bytes is kept, a different one
stops the publication. --stop-after simulates an interrupted upload for the retry rehearsal."""

import argparse
import gzip
from hashlib import sha256
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parent.parent
MANIFEST, SIGNATURE = "manifest.json", "manifest.json.sig"
OPENSSL = os.environ.get("OPENSSL", "openssl")


class ReleaseError(Exception):
    pass


def digest(data):
    return sha256(data).hexdigest()


def lock(name, key):
    match = re.search(rf"^{key}=(\S+)$", (ROOT / name).read_text(), re.M)
    if not match:
        raise ReleaseError(f"{name}: no {key}")
    return match.group(1)


def openssl(*args, **kwargs):
    version = subprocess.run([OPENSSL, "version"], capture_output=True, text=True, check=True).stdout.split()
    if version[0] != "OpenSSL" or int(version[1].split(".")[0]) < 3:
        raise ReleaseError(f"Ed25519 signing needs OpenSSL 3 or later, found {' '.join(version[:2])}")
    return subprocess.run([OPENSSL, *args], capture_output=True, check=False, **kwargs)


def deterministic_tar(source, target):
    """A gzip tar of a directory with sorted entries and no timestamps or owners."""
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w", format=tarfile.PAX_FORMAT) as archive:
        for path in sorted(p for p in source.rglob("*") if p.is_file()):
            info = tarfile.TarInfo(str(PurePosixPath(source.name) / path.relative_to(source).as_posix()))
            data = path.read_bytes()
            info.size, info.mtime, info.mode, info.uid, info.gid = len(data), 0, 0o644, 0, 0
            archive.addfile(info, io.BytesIO(data))
    with open(target, "wb") as file, gzip.GzipFile(fileobj=file, mode="wb", mtime=0, filename="") as compressed:
        compressed.write(buffer.getvalue())


def manifest_for(directory, version, commit):
    artifacts = []
    for path in sorted(p for p in directory.rglob("*") if p.is_file()):
        relative = path.relative_to(directory).as_posix()
        if relative in (MANIFEST, SIGNATURE):
            continue
        data = path.read_bytes()
        artifacts.append({"path": relative, "bytes": len(data), "sha256": digest(data)})
    return {"schema": 1, "version": version, "sourceCommit": commit, "upstreamCommit": lock("upstream.lock", "FLASHPROVE_COMMIT"),
            "abi": 1, "upstreamLockSha256": digest((ROOT / "upstream.lock").read_bytes()),
            "toolchainLockSha256": digest((ROOT / "toolchain.lock").read_bytes()), "artifacts": artifacts}


def stage(version, out, evidence_path, commit):
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?", version):
        raise ReleaseError(f"{version} is not a SemVer version")
    module = (ROOT / "build/wasm/cp_verify.wasm").read_bytes()
    if (ROOT / "build/wasm/cp_verify.wasm.sha256").read_text() != digest(module) + "\n":
        raise ReleaseError("build/wasm/cp_verify.wasm does not match its checksum")
    evidence = json.loads(Path(evidence_path).read_text())
    if evidence.get("status") != "passed" or evidence.get("commit") != commit:
        raise ReleaseError("the release gates did not pass for this commit")
    if evidence.get("moduleSha256") != digest(module):
        raise ReleaseError("the staged module is not the module the release gates tested")
    package = ROOT / f"build/flashprove-wasm-verifier-{version}.tgz"
    if not package.exists():
        raise ReleaseError(f"missing {package.relative_to(ROOT)}; run make package with this version")
    if out.exists():
        shutil.rmtree(out)
    (out / "evidence").mkdir(parents=True)
    copies = {"cp_verify.wasm": "build/wasm/cp_verify.wasm", "cp_verify.wasm.sha256": "build/wasm/cp_verify.wasm.sha256",
              "source.sha256": "build/wasm/source.sha256", "port.sha256": "build/wasm/port.sha256",
              "upstream.lock": "upstream.lock", "toolchain.lock": "toolchain.lock", "LICENSE": "LICENSE", "NOTICE": "NOTICE",
              package.name: package.relative_to(ROOT).as_posix(), "evidence/release-evidence.json": evidence_path,
              "evidence/package-inventory.json": "build/package-inventory.json"}
    for optional in ("build/repro.json", "build/bench/benchmark-full-size.json"):
        if (ROOT / optional).exists():
            copies[f"evidence/{Path(optional).name}"] = optional
    for target, source in copies.items():
        (out / target).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / source, out / target)
    shutil.copytree(ROOT / "build/package/notices", out / "notices")
    if not (ROOT / "build/demo/manifest.json").exists():
        raise ReleaseError("missing build/demo; run make demo")
    deterministic_tar(ROOT / "build/demo", out / f"flashprove-wasm-verifier-demo-{version}.tar.gz")
    manifest = manifest_for(out, version, commit)
    (out / MANIFEST).write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return manifest


def fingerprint(public_key):
    der = openssl("pkey", "-pubin", "-in", str(public_key), "-outform", "DER")
    if der.returncode:
        raise ReleaseError("unreadable public key")
    return digest(der.stdout)


def sign(directory, key):
    result = openssl("pkeyutl", "-sign", "-inkey", str(key), "-rawin", "-in", str(directory / MANIFEST),
                     "-out", str(directory / SIGNATURE))
    if result.returncode:
        raise ReleaseError(f"signing failed: {result.stderr.decode(errors='replace').strip()}")
    with tempfile.NamedTemporaryFile(suffix=".pem") as public:
        openssl("pkey", "-in", str(key), "-pubout", "-out", public.name)
        return fingerprint(public.name)


def verify(directory, public_key, expected_fingerprint=None):
    """Check the signature over the exact manifest bytes, then every artifact and nothing else."""
    if expected_fingerprint and fingerprint(public_key) != expected_fingerprint:
        raise ReleaseError("the public key does not have the expected fingerprint")
    result = openssl("pkeyutl", "-verify", "-pubin", "-inkey", str(public_key), "-rawin",
                     "-in", str(directory / MANIFEST), "-sigfile", str(directory / SIGNATURE))
    if result.returncode:
        raise ReleaseError("the manifest signature does not verify")
    manifest = json.loads((directory / MANIFEST).read_text())
    if manifest.get("schema") != 1 or manifest.get("abi") != 1:
        raise ReleaseError("unknown manifest schema or ABI")
    paths = [artifact["path"] for artifact in manifest["artifacts"]]
    if len(paths) != len(set(paths)) or any(PurePosixPath(p).is_absolute() or ".." in PurePosixPath(p).parts for p in paths):
        raise ReleaseError("manifest paths must be unique relative paths")
    for artifact in manifest["artifacts"]:
        path = directory / artifact["path"]
        if not path.is_file():
            raise ReleaseError(f"missing artifact {artifact['path']}")
        data = path.read_bytes()
        if len(data) != artifact["bytes"] or digest(data) != artifact["sha256"]:
            raise ReleaseError(f"artifact {artifact['path']} does not match the manifest")
    present = {p.relative_to(directory).as_posix() for p in directory.rglob("*") if p.is_file()}
    extra = present - set(paths) - {MANIFEST, SIGNATURE}
    if extra:
        raise ReleaseError(f"files not in the manifest: {', '.join(sorted(extra))}")
    return manifest


class DirectoryStore:
    """A publication target on disk, for dry runs and the retry rehearsal."""

    def __init__(self, path):
        self.path = Path(path)
        self.path.mkdir(parents=True, exist_ok=True)

    def get(self, name):
        target = self.path / name
        return target.read_bytes() if target.exists() else None

    def put(self, name, data):
        target = self.path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


class GitHubReleaseStore:
    """Assets of one GitHub release; nested paths become flat names with '__'."""

    def __init__(self, tag):
        self.tag = tag
        self.work = Path(tempfile.mkdtemp(prefix="fpv-release-"))

    @staticmethod
    def flat(name):
        return name.replace("/", "__")

    def get(self, name):
        target = self.work / self.flat(name)
        result = subprocess.run(["gh", "release", "download", self.tag, "--pattern", self.flat(name), "--dir", str(self.work),
                                 "--clobber"], capture_output=True)
        return target.read_bytes() if result.returncode == 0 and target.exists() else None

    def put(self, name, data):
        target = self.work / self.flat(name)
        target.write_bytes(data)
        subprocess.run(["gh", "release", "upload", self.tag, str(target)], check=True)


def publish(directory, store, stop_after=None):
    """Upload missing assets; keep identical ones; stop at any differing one. Returns counts."""
    manifest = json.loads((directory / MANIFEST).read_text())
    names = [artifact["path"] for artifact in manifest["artifacts"]] + [MANIFEST, SIGNATURE]
    uploaded = kept = 0
    for name in names:
        data = (directory / name).read_bytes()
        existing = store.get(name)
        if existing is not None:
            if digest(existing) != digest(data):
                raise ReleaseError(f"published {name} differs from the staged bytes; publish a new version")
            kept += 1
            continue
        if stop_after is not None and uploaded >= stop_after:
            raise ReleaseError(f"interrupted after {uploaded} uploads (rehearsal)")
        store.put(name, data)
        uploaded += 1
    for name in names:
        published = store.get(name)
        if published is None or digest(published) != digest((directory / name).read_bytes()):
            raise ReleaseError(f"post-publication check failed for {name}")
    return {"uploaded": uploaded, "kept": kept, "assets": len(names)}


def download(store, out):
    """Fetch the published manifest, its signature and every listed asset into out, nested by path."""
    manifest = store.get(MANIFEST)
    if manifest is None:
        raise ReleaseError("no published manifest")
    names = [artifact["path"] for artifact in json.loads(manifest)["artifacts"]] + [MANIFEST, SIGNATURE]
    for name in names:
        data = store.get(name)
        if data is None:
            raise ReleaseError(f"published release lacks {name}")
        (out / name).parent.mkdir(parents=True, exist_ok=True)
        (out / name).write_bytes(data)
    return len(names)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    staging = commands.add_parser("stage")
    staging.add_argument("--version", required=True)
    staging.add_argument("--out", type=Path, default=ROOT / "build/release-stage")
    staging.add_argument("--evidence", default="build/release/release-evidence.json")
    signing = commands.add_parser("sign")
    signing.add_argument("--dir", type=Path, required=True)
    signing.add_argument("--key", type=Path, required=True)
    checking = commands.add_parser("verify")
    checking.add_argument("--dir", type=Path, required=True)
    checking.add_argument("--public-key", type=Path, required=True)
    checking.add_argument("--fingerprint")
    publishing = commands.add_parser("publish")
    publishing.add_argument("--dir", type=Path, required=True)
    target = publishing.add_mutually_exclusive_group(required=True)
    target.add_argument("--store", type=Path)
    target.add_argument("--github-release")
    publishing.add_argument("--stop-after", type=int)
    fetching = commands.add_parser("download")
    fetching.add_argument("--github-release", required=True)
    fetching.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "stage":
            commit = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
            manifest = stage(args.version, args.out, ROOT / args.evidence, commit)
            print(f"release: staged {len(manifest['artifacts'])} artifacts for {args.version} in {args.out}")
        elif args.command == "sign":
            print(f"release: signed; key fingerprint sha256:{sign(args.dir, args.key)}")
        elif args.command == "verify":
            manifest = verify(args.dir, args.public_key, args.fingerprint)
            print(f"release: signature and {len(manifest['artifacts'])} artifacts verified for {manifest['version']}")
        elif args.command == "download":
            print(f"release: downloaded {download(GitHubReleaseStore(args.github_release), args.out)} assets")
        else:
            store = DirectoryStore(args.store) if args.store else GitHubReleaseStore(args.github_release)
            counts = publish(args.dir, store, args.stop_after)
            print(f"release: {counts['uploaded']} uploaded, {counts['kept']} already identical, {counts['assets']} verified after publication")
    except (ReleaseError, OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(f"release: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
