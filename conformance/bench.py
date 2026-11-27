"""Measure full-size whole calls across runtimes and write BenchmarkV1 rows (R-PERF-1, R-PERF-2, #40).

Usage: python3 -m conformance.bench run [--fixture full-size] [--runtimes a,b,...]
       python3 -m conformance.bench validate REPORT

Each runtime gets one warmup and three measured calls on this machine. Process runtimes (native,
Bend, Wasmtime, Node) are timed from launch to exit with files on disk; browser rows are timed in
the page and carry their own scope. The gate fails on a missing runtime, a wrong sample count, an
undeclared scope, a verdict that differs from native, or an unknown fixture digest."""

import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
from statistics import median
from time import monotonic_ns

from conformance.native_c1 import BUILD, ROOT, UPSTREAM

RUNTIMES = ("native", "bend", "wasmtime", "node", "chromium", "firefox", "webkit")
PROCESS_SCOPE = "process: launch through exit, inputs read from disk with a warm page cache"
BROWSER_SCOPE = ("page: one verify() call from admission through the decoded verdict, in a fresh worker and "
                 "fresh instances; inputs already in page memory and the module compiled at setup")
SCOPES = {runtime: PROCESS_SCOPE for runtime in ("native", "bend", "wasmtime", "node")}
SCOPES.update({engine: BROWSER_SCOPE for engine in ("chromium", "firefox", "webkit")})
SAMPLES = 3
REPORT_DIR = BUILD / "bench"


def lock(name, key):
    match = re.search(rf"^{key}=(\S+)$", (ROOT / name).read_text(), re.M)
    if not match:
        raise ValueError(f"{name}: no {key}")
    return match.group(1)


def machine():
    """Hardware and OS facts recorded with every row."""
    cpu = platform.processor() or platform.machine()
    if Path("/proc/cpuinfo").exists():
        found = re.search(r"^model name\s*:\s*(.+)$", Path("/proc/cpuinfo").read_text(), re.M)
        cpu = found.group(1) if found else cpu
    elif shutil.which("sysctl"):
        cpu = subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"], capture_output=True, text=True).stdout.strip() or cpu
    ram = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    virtualization = "unknown"
    if shutil.which("systemd-detect-virt"):
        virtualization = subprocess.run(["systemd-detect-virt"], capture_output=True, text=True).stdout.strip() or "none"
    return {"machine": platform.machine(), "os": platform.platform(), "cpu": cpu, "ramBytes": ram,
            "virtualization": virtualization, "logicalCpus": os.cpu_count()}


def verdict_of(stdout):
    lines = stdout.rstrip(b"\n").split(b"\n")
    return lines[-1].decode("utf-8", "replace") if stdout else ""


def timed_process(command, cwd):
    """Wall time from launch to exit, with the child's peak RSS from wait4."""
    began = monotonic_ns()
    process = subprocess.Popen(command, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env={**os.environ, "LC_ALL": "C"})
    stdout = process.stdout.read()
    _, status, usage = os.wait4(process.pid, 0)
    elapsed = monotonic_ns() - began
    process.returncode = os.waitstatus_to_exitcode(status)
    # ru_maxrss is KiB on Linux and bytes on macOS.
    peak = usage.ru_maxrss * (1 if platform.system() == "Darwin" else 1024)
    return elapsed, process.returncode, verdict_of(stdout), peak


def process_rows(runtime, command, cwd, version):
    runs = [timed_process(command, cwd) for _ in range(SAMPLES + 1)]
    samples = runs[1:]
    codes = {run[1] for run in samples}
    verdicts = {run[2] for run in samples}
    return {"runtime": runtime, "runtimeVersion": version, "timer": "time.monotonic_ns around fork and wait4",
            "memoryMethod": "wait4 ru_maxrss of the measured process", "scope": SCOPES[runtime],
            "warmupCount": 1, "samplesNs": [run[0] for run in samples], "peakBytes": max(run[3] for run in samples),
            "peakKind": "process-max-rss", "exitCode": codes.pop() if len(codes) == 1 else -1,
            "verdict": verdicts.pop() if len(verdicts) == 1 else "inconsistent"}


def browser_row(engine, fixture, args):
    output = subprocess.run(["node", "conformance/bench-browser.mjs", engine, fixture, str(SAMPLES), "--", *args],
                            cwd=ROOT, capture_output=True, text=True, timeout=3600, check=True).stdout
    data = json.loads(output.strip().splitlines()[-1])
    samples = data["samples"]
    codes = {sample["exitCode"] for sample in samples}
    verdicts = {sample["verdict"] for sample in samples}
    return {"runtime": engine, "runtimeVersion": data["version"], "timer": "performance.now in the page",
            "memoryMethod": "none", "scope": SCOPES[engine], "warmupCount": 1,
            "samplesNs": [sample["ns"] for sample in samples], "setupNs": data["setupNs"],
            "exitCode": codes.pop() if len(codes) == 1 else -1,
            "verdict": verdicts.pop() if len(verdicts) == 1 else "inconsistent"}


def run(fixture, runtimes):
    from conformance.memory import invocation  # needs the Wasmtime embedding; validation does not
    args, _ = invocation(fixture)
    host = machine()
    digest = sha256((UPSTREAM / "examples" / fixture / "SHA256SUMS").read_bytes()).hexdigest()
    rows = []
    for runtime in runtimes:
        print(f"bench: {runtime} on {fixture}", flush=True)
        if runtime == "native":
            row = process_rows(runtime, [str(BUILD / "native/cp_verify"), *args], UPSTREAM, f"upstream {lock('upstream.lock', 'FLASHPROVE_COMMIT')}")
        elif runtime == "bend":
            bend = subprocess.run(["scripts/bench-bend.sh"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
            bend_args = [str(UPSTREAM / arg) if arg.startswith("examples/") else arg for arg in args]
            row = process_rows(runtime, [bend, *bend_args, "-data", str(Path(bend).parent)], ROOT,
                               f"flashprove-bend-verifier {lock('bench.lock', 'BEND_VERIFIER_COMMIT')}")
        elif runtime == "wasmtime":
            python = ROOT / ".toolchain/wasmtime-python/bin/python"
            row = process_rows(runtime, [str(python), "-B", "-m", "conformance.wasmtime_whole", "--once", fixture], ROOT,
                               f"wasmtime-python {lock('toolchain.lock', 'WASMTIME_VERSION')}")
        elif runtime == "node":
            node = subprocess.run(["node", "--version"], capture_output=True, text=True, check=True).stdout.strip()
            row = process_rows(runtime, ["node", str(ROOT / "bin/fpv"), *args], UPSTREAM, f"node {node}")
        else:
            browser_args = [arg.removeprefix(f"examples/{fixture}/") for arg in args]
            row = browser_row(runtime, fixture, browser_args)
        row.update(host, schema=1, candidate="baseline", reference="native", fixture=fixture, fixtureSha256=digest,
                   args=args, moduleSha256=sha256((BUILD / "wasm/cp_verify.wasm").read_bytes()).hexdigest(),
                   medianNs=int(median(row["samplesNs"])))
        rows.append(row)
        print(f"bench: {runtime} median {row['medianNs'] / 1e9:.2f} s, samples "
              f"{', '.join(f'{ns / 1e9:.2f}' for ns in row['samplesNs'])} s, exit {row['exitCode']} {row['verdict']}", flush=True)
    return {"schema": 1, "fixture": fixture, "rows": rows}


def validate(report, required=RUNTIMES):
    """Return the gate problems of a benchmark report."""
    problems = []
    rows = {row.get("runtime"): row for row in report.get("rows", [])}
    known = {path.parent.name: sha256(path.read_bytes()).hexdigest()
             for path in (UPSTREAM / "examples").glob("*/SHA256SUMS")}
    for runtime in required:
        if runtime not in rows:
            problems.append(f"{runtime}: missing row")
    native = rows.get("native")
    for runtime, row in rows.items():
        if runtime not in SCOPES:
            problems.append(f"{runtime}: unknown runtime")
            continue
        samples = row.get("samplesNs")
        if row.get("schema") != 1 or row.get("warmupCount") != 1:
            problems.append(f"{runtime}: not BenchmarkV1 with one warmup")
        if not isinstance(samples, list) or len(samples) != SAMPLES or not all(type(ns) is int and ns > 0 for ns in samples):
            problems.append(f"{runtime}: needs {SAMPLES} positive integer samples")
        elif row.get("medianNs") != int(median(samples)):
            problems.append(f"{runtime}: median does not match its samples")
        if row.get("scope") != SCOPES[runtime]:
            problems.append(f"{runtime}: undeclared measurement scope")
        if known.get(row.get("fixture")) != row.get("fixtureSha256"):
            problems.append(f"{runtime}: unknown fixture digest")
        if any(arg in ("-plan", "-key", "-leaf") for arg in row.get("args", [])):
            problems.append(f"{runtime}: not a whole call")
        for field in ("runtimeVersion", "cpu", "os", "machine", "timer", "memoryMethod"):
            if not row.get(field):
                problems.append(f"{runtime}: missing {field}")
        if native and runtime != "native" and (row.get("exitCode"), row.get("verdict")) != (native.get("exitCode"), native.get("verdict")):
            problems.append(f"{runtime}: exit {row.get('exitCode')} {row.get('verdict')!r} differs from native")
        if native and row.get("cpu") != native.get("cpu"):
            problems.append(f"{runtime}: measured on another CPU than native")
    if native and native.get("exitCode") != 0:
        problems.append("native: the reference call did not pass")
    return problems


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    measure = commands.add_parser("run")
    measure.add_argument("--fixture", default="full-size")
    measure.add_argument("--runtimes", default=",".join(RUNTIMES))
    check = commands.add_parser("validate")
    check.add_argument("report", type=Path)
    args = parser.parse_args(argv)
    if args.command == "run":
        runtimes = [name for name in args.runtimes.split(",") if name]
        report = run(args.fixture, runtimes)
        problems = validate(report)
        report["gate"] = {"state": "passed" if not problems else "failed", "problems": problems}
        REPORT_DIR.mkdir(parents=True, exist_ok=True)
        path = REPORT_DIR / f"benchmark-{args.fixture}.json"
        path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    else:
        report = json.loads(args.report.read_text())
        problems = validate(report)
        path = args.report
    for problem in problems:
        print(f"bench gate: {problem}", file=sys.stderr)
    print(f"bench gate: {'passed' if not problems else 'failed'} ({path})")
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
