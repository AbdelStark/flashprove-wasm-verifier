"""Compare the published whole calls in Node and the pinned native oracle."""

import subprocess
import os
import signal

from conformance.compare import Case, RunResult, compare
from conformance.evidence import write_json
from conformance.native_c1 import BUILD, FIXTURES, ROOT, UPSTREAM, cases


def run(command):
    with subprocess.Popen(command, cwd=UPSTREAM, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          start_new_session=True) as proc:
        try:
            stdout, stderr = proc.communicate(timeout=600)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.communicate()
            raise SystemExit("Node replay C1: differential command exceeded the test deadline") from None
        return RunResult(proc.returncode, stdout, stderr)


def main():
    count = 0
    for family, policy in FIXTURES.items():
        _, args, status, verdict = next(cases(f"examples/{family}", policy))
        modes = ("whole", "show-stages") if family == "accepted-proof" else ("whole",)
        for mode in modes:
            argv = [*args, "-show-stages"] if mode == "show-stages" else args
            native = run([BUILD / "native/cp_verify", *argv])
            guest = run(["node", ROOT / "conformance/node-replay-case.mjs", *argv])
            out = BUILD / "node-replay-c1" / family / mode
            out.mkdir(parents=True, exist_ok=True)
            for runtime, result in (("native", native), ("node", guest)):
                (out / f"{runtime}.stdout").write_bytes(result.stdout)
                (out / f"{runtime}.stderr").write_bytes(result.stderr)
            if native.status != status or native.stdout.splitlines()[-1:] != [verdict.encode()]:
                raise SystemExit(f"Node replay C1: invalid oracle for {family}/{mode}")
            result = compare(native, guest, Case(f"{family}/{mode}", "C1", "whole"))
            write_json(out / "case.json", result)
            if result["safetyViolation"] or not result["equal"]:
                raise SystemExit(f"Node replay C1 {family}/{mode}: {result['firstDifference']}. See {out}")
            count += 1
            print(f"Node replay C1: {family}/{mode} exit={status} {verdict}", flush=True)
    print(f"Node replay C1: {count} matching whole calls, 0 equality or safety differences")


if __name__ == "__main__":
    main()
