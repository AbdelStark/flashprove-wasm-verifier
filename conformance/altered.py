"""Generate C2 inputs with the mutation code at the verified upstream pin."""

from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from types import ModuleType


TABLES = {
    "altered_copies.tsv": ("accepted-proof", 10),
    "altered_copies_clipped_gap.tsv": ("accepted-proof-clipped-gap", 10),
    "every_kind_of_item.tsv": ("accepted-proof", 79),
}


@dataclass(frozen=True)
class AlteredCase:
    fixture: str
    table: str
    table_sha256: str
    line: int
    target: str
    expected: str
    commitment: str
    changed: dict[str, bytes]


def source_rows(table, count):
    rows = [(number, line.split("\t")) for number, line in enumerate(table.decode("utf-8").splitlines(), 1)
            if line.strip() and not line.startswith("#")]
    if len(rows) != count or any(len(columns) != 5 for _, columns in rows):
        raise ValueError("invalid upstream C2 table size or row")
    return rows


def upstream_generator(path, fixture):
    module = ModuleType("upstream_altered_copies")
    module.__file__ = str(path)
    # Execute the pinned source without writing a Python cache into the checkout.
    exec(compile(path.read_bytes(), str(path), "exec"), vars(module))
    module.EXAMPLE = fixture
    return module


def altered_cases(root):
    examples = root / ".upstream/FlashProve/examples"
    sources = examples / "rejected-proofs"
    for name, (fixture, count) in TABLES.items():
        table = sources / name
        table_bytes = table.read_bytes()
        rows = source_rows(table_bytes, count)
        digest = sha256(table_bytes).hexdigest()
        generator = upstream_generator(sources / "try_altered_copies.py", examples / fixture)
        try:
            generated = generator.cases(root / "build/native/cp_verify", table)
            for (line, fields), (description, changed, commitment, expected) in zip(rows, generated, strict=True):
                source_description, target, _, _, source_expected = fields
                targets = set() if target == "ID.txt" else {target}
                if description != source_description or expected != source_expected or set(changed) != targets:
                    raise ValueError("upstream C2 generator returned a different row")
                yield AlteredCase(fixture, name, digest, line, target, expected, commitment, changed)
        except generator.FaultyTable as failure:
            raise ValueError("upstream C2 generator rejected a row") from failure
