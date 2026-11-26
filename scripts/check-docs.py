#!/usr/bin/env python3
"""Repository checks that need no toolchain: lock files parse, every relative link in the
Markdown resolves, every requirement ID cited outside SPEC.md is defined in it, and prose has no
em or en dashes. Exit 1 on any finding."""
import pathlib, re, sys

root = pathlib.Path(__file__).resolve().parent.parent
bad = []
skip = {".git", ".upstream", ".toolchain", "build", "node_modules"}
docs = [p for p in root.rglob("*.md") if not skip & set(p.relative_to(root).parts)]

for lock, keys in {"upstream.lock": ["FLASHPROVE_REPO", "FLASHPROVE_COMMIT", "FLASHPROVE_VERSION"],
                   "toolchain.lock": ["WASI_SDK_VERSION", "WASMTIME_VERSION", "NODE_MAJOR"]}.items():
    text = (root / lock).read_text()
    for k in keys:
        if not re.search(rf"^{k}=\S+$", text, re.M):
            bad.append(f"{lock}: missing {k}")
    for m in re.finditer(r"^(\w+_SHA256_\w+)=(\S*)$", text, re.M):
        if not re.fullmatch(r"[0-9a-f]{64}", m.group(2)):
            bad.append(f"{lock}: {m.group(1)} is not a SHA-256")

spec = (root / "SPEC.md").read_text()
defined = set(re.findall(r"\*\*(R-[A-Z]+-\d+)\b", spec))
for p in docs:
    rel = p.relative_to(root)
    text = p.read_text()
    for n, line in enumerate(text.splitlines(), 1):
        if "—" in line or "–" in line:
            bad.append(f"{rel}:{n}: em or en dash")
    for target in re.findall(r"\]\(([^)\s]+)\)", text):
        if re.match(r"[a-z]+:", target) or target.startswith("#"):
            continue
        path = (p.parent / target.split("#")[0]).resolve()
        if not path.exists():
            bad.append(f"{rel}: broken link {target}")
    for rid in set(re.findall(r"\bR-[A-Z]+-\d+\b", text)):
        if rid not in defined:
            bad.append(f"{rel}: {rid} is not defined in SPEC.md")

for b in bad:
    print(b)
print(f"check-docs: {len(docs)} files, {len(defined)} requirements, {len(bad)} findings")
sys.exit(1 if bad else 0)
