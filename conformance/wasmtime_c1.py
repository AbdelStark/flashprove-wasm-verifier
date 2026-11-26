"""Compare C1 part calls and plans in Wasmtime with the native oracle."""

from pathlib import Path
import subprocess
import sys

from conformance.compare import Case, RunResult, compare, load_exclusions
from conformance.evidence import write_json
from conformance.native_c1 import BUILD, FIXTURES, UPSTREAM, cases
from host.wasmtime.stages import FAILED, PartRunner, Result


def fixture_files(family, stage):
    root = f"examples/{family}"
    paths = ["config/policy.txt", "config/KL.bin", "config/layout.txt"]
    if stage in ("key", "leaf", "plan-id"):
        paths.append("ivk/key.bin")
    if stage == "leaf":
        paths.append("ivk/leaf/0.bin")
    if stage == "plan-request":
        paths.extend(("example.req", "example.y"))
    return {f"/{root}/{path}".encode(): (UPSTREAM / root / path).read_bytes() for path in paths}


def run_guest(runner, args, files):
    return runner.run(tuple(arg.encode("utf-8") for arg in ("cp_verify", *args)), files)


def thread_boundaries(runner):
    family = "accepted-proof"
    key = next(args for stage, args, _, _ in cases(f"examples/{family}", None) if stage == "key")
    files = fixture_files(family, "key")
    for threads, status in ((0, 2), (1, 3), (256, 3), (257, 2)):
        guest = run_guest(runner, [*key, "-j", str(threads)], files)
        if guest.status != status:
            raise SystemExit(f"Wasmtime -j {threads}: expected exit {status}, got {guest.status}")
        if status == 3 and guest.stdout.splitlines()[-1:] != [b"PART PASSED: key"]:
            raise SystemExit(f"Wasmtime -j {threads}: unexpected key result")
        if status == 2 and b"after -j comes a whole number from 1 to 256" not in guest.stderr:
            raise SystemExit(f"Wasmtime -j {threads}: missing usage refusal")
        print(f"wasm build test: -j {threads} exit={status}")
    guard = run_guest(runner, ["/config", "/ivk", "/request", "/reply", "/proof"], {})
    if guard != Result(5, FAILED, b""):
        raise SystemExit("Wasmtime accepted a whole call at the part-call entry point")


def save(out, label, stdout, stderr):
    (out / f"{label}.stdout").write_bytes(stdout)
    (out / f"{label}.stderr").write_bytes(stderr)


def main():
    runner = PartRunner(BUILD / "wasm/cp_verify.wasm")
    if sys.argv[1:] == ["--thread-boundaries"]:
        thread_boundaries(runner)
        return
    evidence = None
    if len(sys.argv) == 3 and sys.argv[1] == "--evidence":
        evidence = Path(sys.argv[2])
    elif sys.argv[1:]:
        raise SystemExit("unknown part-call test option")
    exclusions = load_exclusions()
    parts = plans = 0
    equal_failures = 0
    for family, policy in FIXTURES.items():
        out = BUILD / "wasmtime-c1" / family
        out.mkdir(parents=True, exist_ok=True)
        for stage, args, status, verdict in cases(f"examples/{family}", policy):
            if stage == "whole":
                continue
            native = subprocess.run([BUILD / "native/cp_verify", *args], cwd=UPSTREAM, capture_output=True)
            guest = run_guest(runner, args, fixture_files(family, stage))
            save(out, f"{stage}.native", native.stdout, native.stderr)
            save(out, f"{stage}.wasm", guest.stdout, guest.stderr)
            ending = [verdict.encode()]
            if native.returncode != status or native.stdout.splitlines()[-1:] != ending:
                raise SystemExit(f"Wasmtime C1 {family}/{stage}: native oracle missed the expected outcome. See {out}")
            mode = "plan" if stage.startswith("plan-") else stage
            failure = "host-internal" if guest == Result(5, FAILED, b"") else None
            result = compare(RunResult(native.returncode, native.stdout, native.stderr),
                             RunResult(guest.status, guest.stdout, guest.stderr, failure),
                             Case(f"{family}/{stage}", "C1", mode), exclusions)
            write_json(out / f"{stage}.json", result)
            if evidence is not None:
                write_json(evidence / f"{family}-{stage}.json", result)
            if result["safetyViolation"]:
                raise SystemExit(f"Wasmtime C1 {family}/{stage}: safety violation. See local case record.")
            if not result["equal"]:
                equal_failures += 1
                print(f"Wasmtime C1: {family}/{stage} differs at {result['firstDifference']}", flush=True)
                continue
            if mode == "plan":
                plans += 1
            else:
                parts += 1
            print(f"Wasmtime C1: {family}/{stage} exit={status} {verdict}", flush=True)
    print(f"Wasmtime C1: {parts} matching part calls, {plans} matching plans, {equal_failures} equality differences")
    if equal_failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
