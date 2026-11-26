"""Pinned C5 seed mapping and replayable fixture operations."""

from dataclasses import dataclass


GENERATOR_VERSION = 1
MASK = (1 << 64) - 1
FIXTURE_IDS = ("accepted-proof", "accepted-proof-clipped-gap")
INPUTS = {
    "proof": ("example.proof",),
    "key": ("ivk/key.bin",),
    "leaf": ("ivk/leaf/0.bin",),
    "request": ("example.req",),
    "token": ("example.y",),
    "configuration": ("config/policy.txt", "config/KL.bin", "config/layout.txt"),
}
TARGETS = frozenset(target for targets in INPUTS.values() for target in targets)


class SplitMix64:
    def __init__(self, seed):
        self.state = seed & MASK

    def next(self):
        self.state = (self.state + 0x9E3779B97F4A7C15) & MASK
        word = self.state
        word = ((word ^ (word >> 30)) * 0xBF58476D1CE4E5B9) & MASK
        word = ((word ^ (word >> 27)) * 0x94D049BB133111EB) & MASK
        return word ^ (word >> 31)

    def pick(self, values):
        return values[self.next() % len(values)]


@dataclass(frozen=True)
class Operation:
    target: str
    kind: str
    offset: int
    value: int | None = None

    def record(self):
        record = {"target": self.target, "kind": self.kind, "offset": self.offset}
        if self.value is not None:
            record["value"] = self.value
        return record


@dataclass(frozen=True)
class SeedCase:
    seed: int
    input_class: str
    fixture: str
    operations: tuple[Operation, ...]


def generate(seed, size):
    if type(seed) is not int or not 0 <= seed <= MASK:
        raise ValueError("seed is outside the unsigned 64-bit range")
    generator = SplitMix64(seed)
    input_class = generator.pick(tuple(INPUTS))
    fixture = generator.pick(FIXTURE_IDS)
    target = generator.pick(INPUTS[input_class])
    kind = generator.pick(("flip", "truncate", "append"))
    length = size(fixture, target)
    if length < 1:
        raise ValueError("empty registered fixture file")
    if kind == "append":
        operation = Operation(target, kind, length, generator.next() % 256)
    else:
        offset = generator.next() % length
        value = 1 << (generator.next() % 8) if kind == "flip" else None
        operation = Operation(target, kind, offset, value)
    return SeedCase(seed, input_class, fixture, (operation,))


def read_operation(record):
    if type(record) is not dict:
        raise ValueError("invalid mutation operation")
    target, kind, offset, value = (record.get(field) for field in ("target", "kind", "offset", "value"))
    if not isinstance(target, str) or target not in TARGETS or type(offset) is not int or offset < 0:
        raise ValueError("invalid mutation target or offset")
    fields = {"target", "kind", "offset"}
    if kind == "truncate" and record.keys() == fields:
        return Operation(target, kind, offset)
    if record.keys() != fields | {"value"} or type(value) is not int:
        raise ValueError("invalid mutation fields")
    if kind == "flip" and value in (1, 2, 4, 8, 16, 32, 64, 128):
        return Operation(target, kind, offset, value)
    if kind == "append" and 0 <= value <= 255:
        return Operation(target, kind, offset, value)
    raise ValueError("invalid mutation kind or value")


def mutate(data, operation):
    at = operation.offset
    if operation.kind == "append" and at == len(data):
        return data + bytes((operation.value,))
    if 0 <= at < len(data):
        if operation.kind == "truncate":
            return data[:at]
        if operation.kind == "flip":
            return data[:at] + bytes((data[at] ^ operation.value,)) + data[at + 1:]
    raise ValueError("mutation offset does not fit the fixture")
