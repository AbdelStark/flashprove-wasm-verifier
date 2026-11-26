"""Byte-level conformance checks and redacted CaseResultV1 records."""

from dataclasses import dataclass
from itertools import zip_longest
from pathlib import Path
import re
from typing import Optional


EXCLUSIONS = Path(__file__).with_name("excluded-fields.txt")
KNOWN_EXITS = {0, 1, 2, 3, 4, 5, 14, 15}
HOST_FAILURES = {"input-limit", "invalid-input", "busy", "memory-limit", "output-limit", "timeout",
                 "trap", "runtime-oom", "replay-mismatch", "abi", "worker", "integrity", "host-io", "host-internal"}
STAGE_HEADER = re.compile(rb"---- stage (?:key|leaf|request) ---- ([0-9]+) thread\(s\), ([0-9]+\.[0-9]{3}) s")
APPROVED_EXCLUSIONS = {"stage-thread-count": 1, "stage-wall-time": 2}
POLICY = re.compile(rb"WITHIN LIMITS: clipped-gap C=[0-9]{1,20} theta=[0-9]{1,20} cap=[0-9]{1,20} s=[0-9]{1,20} sh=[0-9]{1,20}")
PARTS = (b"PART PASSED: key", b"PART PASSED: leaf")
CALL_MARKER = b"---- the call ----\n"


@dataclass(frozen=True)
class RunResult:
    status: int
    stdout: bytes
    stderr: bytes
    host_failure: Optional[str] = None


@dataclass(frozen=True)
class Case:
    id: str
    corpus: str
    mode: str


def load_exclusions(path=EXCLUSIONS):
    rules = set()
    for number, line in enumerate(path.read_text().splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        fields = line.split("\t")
        if (len(fields) != 2 or fields[0] not in APPROVED_EXCLUSIONS or not fields[1].strip()
                or fields[0] in rules):
            raise ValueError(f"invalid output exclusion at line {number}")
        rules.add(fields[0])
    return frozenset(rules)


def lines(data):
    parts = data.split(b"\n")
    return [line + b"\n" for line in parts[:-1]] + ([parts[-1]] if parts[-1] else [])


def verdict(output):
    return output[-1].removesuffix(b"\n") if output else b""


def pass_line(line):
    return line == b"YES" or line.startswith((b"WITHIN LIMITS:", b"PART PASSED:"))


def valid_pass(status, line, mode):
    if mode == "whole":
        return status == 0 and (line == b"YES" or POLICY.fullmatch(line) is not None)
    return status == 3 and mode in ("key", "leaf") and line == b"PART PASSED: " + mode.encode("ascii")


def public_verdict(line):
    if line in (b"YES", b"NOT-A-VERIFICATION", b"PLAN ONLY: no proof was checked", *PARTS) or POLICY.fullmatch(line):
        return line.decode("ascii")
    for prefix in (b"NO:", b"NOT CHECKED:"):
        if line.startswith(prefix):
            return prefix[:-1].decode("ascii")
    return None


def normalize(line, exclusions):
    if not exclusions:
        return line
    match = STAGE_HEADER.fullmatch(line.removesuffix(b"\n"))
    if match is None:
        return line
    for name, group in sorted(APPROVED_EXCLUSIONS.items(), key=lambda item: item[1], reverse=True):
        if name in exclusions:
            start, end = match.span(group)
            line = line[:start] + b"<excluded>" + line[end:]
    return line


def closing(output, mode, status):
    if mode == "plan":
        return output
    if mode == "whole" and status in (0, 14):
        return output[-4:]
    if mode in ("key", "leaf"):
        for index in range(len(output) - 1, -1, -1):
            if output[index] == CALL_MARKER:
                return output[index:]
    return output[-1:]


def first_byte_difference(stream, expected, actual, exclusions):
    for number, (native, guest) in enumerate(zip_longest(expected, actual, fillvalue=b""), 1):
        a, b = (normalize(native, exclusions), normalize(guest, exclusions)) if stream == "stdout" else (native, guest)
        if a != b:
            column = next((i for i, (x, y) in enumerate(zip(a, b), 1) if x != y), min(len(a), len(b)) + 1)
            return {"kind": "bytes", "stream": stream, "line": number, "byte": column}
    return None


def compare(native, guest, case, exclusions=frozenset()):
    if case.mode not in ("whole", "key", "leaf", "plan") or exclusions - APPROVED_EXCLUSIONS.keys():
        raise ValueError("invalid comparison mode or output exclusion")
    native_lines, guest_lines = lines(native.stdout), lines(guest.stdout)
    native_verdict, guest_verdict = verdict(native_lines), verdict(guest_lines)
    native_pass = valid_pass(native.status, native_verdict, case.mode)
    guest_pass = valid_pass(guest.status, guest_verdict, case.mode)
    if (native.host_failure is not None or native.status not in KNOWN_EXITS
            or ((native.status in (0, 3) or pass_line(native_verdict)) and not native_pass)):
        raise ValueError("invalid native oracle result")
    if native.status == 3 and CALL_MARKER not in native_lines:
        raise ValueError("invalid native part-call closing record")
    if native.status == 4 and (case.mode != "plan" or native_verdict != b"PLAN ONLY: no proof was checked"):
        raise ValueError("invalid native planning verdict")
    if native.status == 14 and native_verdict != b"NOT-A-VERIFICATION":
        raise ValueError("invalid native not-a-verification verdict")
    if case.mode == "whole" and native.status in (0, 14):
        prefixes = (b"commitment: ", b"proof of work: ", b"result-v1 ")
        if len(native_lines) < 4 or not all(line.startswith(prefix) for line, prefix in zip(native_lines[-4:-1], prefixes)):
            raise ValueError("invalid native whole-call closing record")
    if guest.host_failure is not None and guest.host_failure not in HOST_FAILURES:
        raise ValueError("unknown guest host failure")

    signals_pass = guest.status in (0, 3) or pass_line(guest_verdict)
    unsafe = signals_pass and (not native_pass or not guest_pass or native.status != guest.status
                               or native_verdict != guest_verdict or guest.host_failure is not None)
    if native.status != guest.status:
        difference = {"kind": "exit"}
    elif native_verdict != guest_verdict:
        difference = {"kind": "verdict"}
    else:
        native_err, guest_err = lines(native.stderr), lines(guest.stderr)
        if case.mode != "plan":
            native_err, guest_err = native_err[-1:], guest_err[-1:]
        difference = first_byte_difference("stdout", closing(native_lines, case.mode, native.status),
                                           closing(guest_lines, case.mode, guest.status), exclusions)
        if difference is None:
            difference = first_byte_difference("stderr", native_err, guest_err, exclusions)
        if difference is None and guest.host_failure is not None:
            difference = {"kind": "host-failure"}

    result = {"schema": 1, "caseId": case.id, "corpus": case.corpus, "mode": case.mode,
              "nativeExit": native.status, "guestExit": guest.status, "nativeVerdict": public_verdict(native_verdict),
              "guestVerdict": public_verdict(guest_verdict), "equal": difference is None, "safetyViolation": unsafe}
    if difference is not None:
        result["firstDifference"] = difference
    if guest.host_failure is not None:
        result["hostFailure"] = guest.host_failure
    return result
