#!/usr/bin/env python3
"""Check locks, links and anchors, requirement and ADR references, RFC and ADR metadata, milestones,
prose and the documented guest ABI. Reads only the working tree; downloads nothing."""
import json
import pathlib
import re
import sys

SKIP = {".git", ".upstream", ".toolchain", "build", "node_modules"}
RFC_STATUS = {"Draft", "Accepted", "Rejected", "Superseded", "Implemented"}
RFC_SECTIONS = ["Summary", "Motivation", "Goals", "Non-Goals", "Proposed Design", "Alternatives Considered",
                "Drawbacks", "Migration / Rollout", "Testing Strategy", "Open Questions", "References"]
ADR_STATUS = re.compile(r"^(?:- )?Status: (?:accepted|superseded|deprecated|proposed)\b", re.I)


def prose(text):
    """Lines outside fenced code blocks, with their line numbers."""
    fenced = False
    for number, line in enumerate(text.splitlines(), 1):
        if line.lstrip().startswith("```"):
            fenced = not fenced
            continue
        if not fenced:
            yield number, line


def anchors(text):
    """GitHub heading slugs: lowercase, punctuation dropped, spaces to hyphens, -N for repeats."""
    seen, found = {}, set()
    for _, line in prose(text):
        match = re.match(r"^#{1,6}\s+(.*?)\s*#*\s*$", line)
        if not match:
            continue
        heading = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", match.group(1))
        slug = re.sub(r"[^\w\- ]", "", heading.strip().lower()).replace(" ", "-")
        count = seen.get(slug, 0)
        seen[slug] = count + 1
        found.add(slug if count == 0 else f"{slug}-{count}")
    for match in re.finditer(r'<a (?:id|name)="([^"]+)"', text):
        found.add(match.group(1))
    return found


def check_locks(root, bad):
    for lock, keys in {"upstream.lock": ["FLASHPROVE_REPO", "FLASHPROVE_COMMIT", "FLASHPROVE_VERSION"],
                       "toolchain.lock": ["WASI_SDK_VERSION", "WASMTIME_VERSION", "NODE_MAJOR"]}.items():
        path = root / lock
        if not path.exists():
            bad.append(f"{lock}: missing")
            continue
        text = path.read_text()
        for key in keys:
            if not re.search(rf"^{key}=\S+$", text, re.M):
                bad.append(f"{lock}: missing {key}")
        for match in re.finditer(r"^(\w+_SHA256_\w+)=(\S*)$", text, re.M):
            if not re.fullmatch(r"[0-9a-f]{64}", match.group(2)):
                bad.append(f"{lock}: {match.group(1)} is not a SHA-256")


def milestones(spec):
    return set(re.findall(r"^\| (M\d+) [^|]+\|", spec, re.M))


def check_rfc(path, rel, text, known, bad):
    number = re.match(r"RFC-(\d{4})-", path.name)
    lines = text.splitlines()
    if not number or not lines or not re.fullmatch(rf"# RFC-{number.group(1)}: \S.*", lines[0]):
        bad.append(f"{rel}: title must be '# RFC-NNNN: ...' with the file's number")
    meta = dict(re.findall(r"^- (Status|Authors|Created|Target milestone): (.*)$", "\n".join(lines[:8]), re.M))
    if meta.get("Status", "").split(".")[0] not in RFC_STATUS:
        bad.append(f"{rel}: missing or unknown RFC Status")
    if not meta.get("Authors", "").strip():
        bad.append(f"{rel}: missing RFC Authors")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", meta.get("Created", "")):
        bad.append(f"{rel}: missing or malformed RFC Created date")
    targets = [item.strip() for item in meta.get("Target milestone", "").split(",") if item.strip()]
    if not targets:
        bad.append(f"{rel}: missing RFC Target milestone")
    for target in targets:
        if target not in known:
            bad.append(f"{rel}: unknown milestone {target}")
    sections = [line[3:].strip() for _, line in prose(text) if line.startswith("## ")]
    if sections != RFC_SECTIONS:
        bad.append(f"{rel}: RFC sections must be {', '.join(RFC_SECTIONS)} in order")


def check_adr(path, rel, text, bad):
    number = re.match(r"(\d{4})-", path.name)
    lines = text.splitlines()
    if not number or not lines or not re.fullmatch(rf"# {number.group(1)}\. \S.*", lines[0]):
        bad.append(f"{rel}: title must be '# NNNN. ...' with the file's number")
    if not any(ADR_STATUS.match(line) for line in lines[1:6]):
        bad.append(f"{rel}: missing ADR Status")


def findings(root):
    """Return (findings, document count, requirement count) for the tree at root."""
    root = pathlib.Path(root)
    bad = []
    docs = sorted(p for p in root.rglob("*.md") if not SKIP & set(p.relative_to(root).parts))
    check_locks(root, bad)
    spec = (root / "SPEC.md").read_text() if (root / "SPEC.md").exists() else ""
    defined = set(re.findall(r"\*\*(R-[A-Z]+-\d+)\b", spec))
    known = milestones(spec)
    adrs = {path.name[:4] for path in (root / "docs/adr").glob("[0-9][0-9][0-9][0-9]-*.md")}
    slugs = {}

    def slugs_of(path):
        if path not in slugs:
            slugs[path] = anchors(path.read_text())
        return slugs[path]

    for path in docs:
        rel = path.relative_to(root)
        text = path.read_text()
        for number, line in enumerate(text.splitlines(), 1):
            if "—" in line or "–" in line:
                bad.append(f"{rel}:{number}: em or en dash")
        body = "\n".join(line for _, line in prose(text))
        for target in re.findall(r"\]\(([^)\s]+)\)", body):
            if re.match(r"[a-z]+:", target):
                continue
            file, _, anchor = target.partition("#")
            linked = (path.parent / file).resolve() if file else path
            if not linked.exists():
                bad.append(f"{rel}: broken link {target}")
            elif anchor and linked.suffix == ".md" and anchor not in slugs_of(linked):
                bad.append(f"{rel}: no heading for anchor {target}")
        for rid in sorted(set(re.findall(r"\bR-[A-Z]+-\d+\b", text))):
            if rid not in defined:
                bad.append(f"{rel}: {rid} is not defined in SPEC.md")
        for adr in sorted(set(re.findall(r"\bADR[- ](\d{4})\b", body))):
            if adr not in adrs:
                bad.append(f"{rel}: ADR {adr} does not exist")
        parts = rel.parts
        if parts[:2] == ("docs", "rfcs") and path.name.startswith("RFC-"):
            check_rfc(path, rel, text, known, bad)
        if parts[:2] == ("docs", "adr") and re.match(r"\d{4}-", path.name):
            check_adr(path, rel, text, bad)
        if parts[:2] == ("docs", "roadmap"):
            for _, line in prose(text):
                heading = re.match(r"^## (M\d+)\b", line)
                if heading and heading.group(1) not in known:
                    bad.append(f"{rel}: unknown milestone {heading.group(1)}")
    return bad, len(docs), len(defined)


def main():
    root = pathlib.Path(__file__).resolve().parent.parent
    bad, count, requirements = findings(root)
    sys.path.insert(0, str(root / "scripts"))
    from audit_wasm import BASELINE, check_abi_documentation
    try:
        documented = check_abi_documentation(json.loads(BASELINE.read_text()))
        print(f"ABI v1: {documented} documented tuples match the reviewed imports")
    except (OSError, ValueError) as error:
        bad.append(f"port/ABI.md: {error}")
    for finding in bad:
        print(finding)
    print(f"check-docs: {count} files, {requirements} requirements, {len(bad)} findings")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
