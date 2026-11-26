"""Check the native oracle against the pinned examples' published outcomes."""

from collections import Counter
from pathlib import Path
import re
import subprocess


ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = ROOT / ".upstream/FlashProve"
BUILD = ROOT / "build"
FIXTURES = {
    "accepted-proof": None,
    "accepted-proof-clipped-gap": (9244130, 323343, 1, 16, 8),
    "full-size": None,
    "full-size-clipped-gap": (25856, 512, 1, 15, 8),
}


def cases(fixture, policy):
    config = f"{fixture}/config"
    ivk = f"{fixture}/ivk"
    key = f"{ivk}/key.bin"
    request = f"{fixture}/example.req"
    reply = f"{fixture}/example.y"
    commitment = (UPSTREAM / fixture / "ID.txt").read_text().strip()
    identity = ["-id", commitment, "-q"]
    whole = [config, ivk, request, reply, f"{fixture}/example.proof", *identity]
    verdict = "YES"
    if policy is not None:
        whole += ["-policy", "clipped-gap," + ",".join(map(str, policy))]
        limits = " ".join(f"{name}={value}" for name, value in zip(("C", "theta", "cap", "s", "sh"), policy))
        verdict = f"WITHIN LIMITS: clipped-gap {limits}"
    yield "whole", whole, 0, verdict
    yield "key", ["-key", config, key, *identity], 3, "PART PASSED: key"
    yield "leaf", ["-leaf", config, key, f"{ivk}/leaf/0.bin", *identity], 3, "PART PASSED: leaf"

    plan = "PLAN ONLY: no proof was checked"
    yield "plan-id", ["-plan", "id", config, key], 4, plan
    yield "plan-accounting", ["-plan", "accounting", config, "128"], 4, plan
    yield "plan-arrays", ["-plan", "arrays", config, "128"], 4, plan
    yield "plan-request", [
        "-plan", "request", f"{config}/policy.txt", f"{config}/KL.bin", "128",
        "-layout", f"{config}/layout.txt", "-prompt", request, "-reply", reply, "-q",
    ], 4, plan


def main():
    log = (BUILD / "native-build.log").read_text()
    digest = re.search(r"^build=([0-9a-f]{64}) dw=8$", log, re.MULTILINE)
    if digest is None:
        raise SystemExit("native C1: upstream build digest is missing")

    counts = Counter()
    for family, policy in FIXTURES.items():
        results = BUILD / "native-c1" / family
        results.mkdir(parents=True, exist_ok=True)
        for name, args, status, verdict in cases(f"examples/{family}", policy):
            run = subprocess.run(
                [BUILD / "native/cp_verify", *args], cwd=UPSTREAM, capture_output=True, check=False,
            )
            (results / f"{name}.stdout").write_bytes(run.stdout)
            (results / f"{name}.stderr").write_bytes(run.stderr)
            lines = run.stdout.splitlines()
            if run.returncode != status or lines[-1:] != [verdict.encode()]:
                raise SystemExit(f"{family}/{name}: expected exit {status} and {verdict}, got exit {run.returncode}. See {results}")
            if status == 0 and (
                len(lines) < 4 or not lines[-4].startswith(b"commitment: ")
                or not lines[-3].startswith(b"proof of work: ")
                or not lines[-2].startswith(b"result-v1 status=0 ")
                or not lines[-2].endswith(f" dw=8 build={digest[1]}".encode())
            ):
                raise SystemExit(f"{family}/{name}: unexpected closing record or build digest. See {results}")
            counts[verdict.split(":", 1)[0]] += 1
            print(f"native C1: {family}/{name} exit={status} {verdict}", flush=True)
    print(f"native C1: {sum(counts.values())} cases, " + ", ".join(f"{verdict}={count}" for verdict, count in counts.items()))


if __name__ == "__main__":
    main()
