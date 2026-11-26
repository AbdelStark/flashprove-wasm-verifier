"""Persist numeric gate counts and difference locations without raw values."""

from contextlib import contextmanager
import json
from pathlib import Path


class Mismatch(ValueError):
    def __init__(self, message, **location):
        super().__init__(message)
        self.location = location


def write_json(path, result):
    path.write_text(json.dumps(result, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")


@contextmanager
def numeric_evidence(path):
    result = {"schema": 1, "counts": {}}
    try:
        yield result["counts"]
    except Mismatch as error:
        result["firstDifference"] = error.location
        raise
    finally:
        if path is not None:
            write_json(Path(path), result)
