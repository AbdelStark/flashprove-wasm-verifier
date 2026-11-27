"""Build and compare the opt-in candidates against the baseline on one machine (#42, #43, RFC-0009).

Usage: python -m conformance.candidates [--fixture full-size] [--candidates simd,wide]
       python -m conformance.candidates --once MODULE_DIR FIXTURE   (one whole call, for timing)

Each build is audited by scripts/build-wasm.sh with WASM_CANDIDATE set. Every runtime that can run a
build measures one warmup and three whole calls in fresh processes. A candidate's stdout must equal the
baseline's on every call, apart from the approved stage-heading exclusions; the native comparison of
the baseline itself is the conformance gate's job. The report records samples, medians, instruction
counts and module hashes. It decides nothing: promotion needs an ADR and the full gates."""

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

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"
OUT = BUILD / "candidates"
HEADING = re.compile(rb"^(---- stage (?:key|leaf|request) ----) [0-9]+ thread\(s\), [0-9]+\.[0-9]{3} s$", re.M)
# Runtimes able to run each build. V8 in the pinned Node has no wide-arithmetic support.
RUNTIMES = {"baseline": ("wasmtime", "node"), "simd": ("wasmtime", "node"), "wide": ("wasmtime",)}
INSTRUCTIONS = {"simd": rb"\s(?:v128|i8x16|i16x8|i32x4|i64x2|f32x4|f64x2)\.", "wide": rb"\si64\.mul_wide_[su]\b"}
NODE_ONCE = """
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
const [dir, fixture] = process.argv.slice(2);
const { captureCall } = await import(join(process.cwd(), "build/ts/host/namespace.js"));
const { runNodeGuest } = await import(join(process.cwd(), "build/ts/host/node-replay.js"));
const module = new WebAssembly.Module(readFileSync(join(dir, "cp_verify.wasm")));
const root = join(".upstream/FlashProve/examples", fixture);
const files = new Map();
const walk = (d, p) => { for (const n of readdirSync(d)) { const f = join(d, n);
  if (statSync(f).isDirectory()) walk(f, p + n + "/"); else files.set("/" + p + n, new Uint8Array(readFileSync(f))); } };
walk(root, "");
const id = new TextDecoder().decode(files.get("/ID.txt")).trim();
const argv = ["cp_verify", "config", "ivk", "example.req", "example.y", "example.proof", "-id", id, ...process.argv.slice(4)];
const result = runNodeGuest(module, () => captureCall(files, argv));
process.stdout.write(result.stdout);
process.exitCode = result.status;
"""


def build(name):
    env = {**os.environ}
    env.pop("WASM_CANDIDATE", None)
    if name != "baseline":
        env["WASM_CANDIDATE"] = name
    subprocess.run([str(ROOT / "scripts/build-wasm.sh")], cwd=ROOT, env=env, check=True, stdout=subprocess.DEVNULL)
    target = OUT / name
    target.mkdir(parents=True, exist_ok=True)
    for file in ("cp_verify.wasm", "cp_verify.wasm.sha256", "source.sha256", "port.sha256"):
        shutil.copy(BUILD / "wasm" / file, target / file)
    return target


def instruction_counts(module):
    listing = subprocess.run([str(ROOT / ".toolchain/wasi-sdk/bin/llvm-objdump"), "-d", str(module)],
                             capture_output=True, check=True).stdout
    return {name: len(re.findall(pattern, listing)) for name, pattern in INSTRUCTIONS.items()}


def once(module_dir, fixture):
    """One whole call in the Wasmtime host on the module in module_dir."""
    sys.path.insert(0, str(ROOT))
    from conformance.memory import PARENT_PAGES, invocation, snapshot
    from host.wasmtime.stages import MAX_PAGES, PartRunner
    args, _ = invocation(fixture)
    files, _ = snapshot(fixture)
    runner = PartRunner(Path(module_dir) / "cp_verify.wasm", max_pages=MAX_PAGES, parent_pages=PARENT_PAGES)
    result = runner._run(tuple(arg.encode() for arg in ("cp_verify", *args)), files, stages=3)
    sys.stdout.buffer.write(result.stdout)
    return result.status


def measure(command, env, cwd=ROOT):
    runs = []
    for _ in range(4):
        began = monotonic_ns()
        process = subprocess.run(command, cwd=cwd, capture_output=True, env=env)
        runs.append((monotonic_ns() - began, process.returncode, process.stdout))
    samples = [ns for ns, _, _ in runs[1:]]
    return {"warmupCount": 1, "samplesNs": samples, "medianNs": int(median(samples)),
            "exitCodes": sorted({code for _, code, _ in runs}),
            "verdict": runs[-1][2].rstrip(b"\n").rsplit(b"\n", 1)[-1].decode("utf-8", "replace"),
            "outputs": {HEADING.sub(rb"\1", stdout) for _, _, stdout in runs}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--once", nargs=2, metavar=("MODULE_DIR", "FIXTURE"))
    parser.add_argument("--fixture", default="full-size")
    parser.add_argument("--candidates", default="simd,wide")
    args = parser.parse_args(argv)
    if args.once:
        return once(*args.once)
    names = ["baseline", *[name for name in args.candidates.split(",") if name]]
    python = str(ROOT / ".toolchain/wasmtime-python/bin/python")
    node_script = OUT / "node-once.mjs"
    OUT.mkdir(parents=True, exist_ok=True)
    node_script.write_text(NODE_ONCE)
    builds = {name: build(name) for name in names}
    build(names[0])  # leave the baseline in build/wasm
    report = {"schema": 1, "fixture": args.fixture, "machine": platform.machine(), "os": platform.platform(),
              "cpu": platform.processor() or platform.machine(), "logicalCpus": os.cpu_count(), "builds": {}}
    if Path("/proc/cpuinfo").exists():
        found = re.search(r"^model name\s*:\s*(.+)$", Path("/proc/cpuinfo").read_text(), re.M)
        report["cpu"] = found.group(1) if found else report["cpu"]
    baseline_outputs = {}
    problems = []
    for name in names:
        module = builds[name] / "cp_verify.wasm"
        entry = {"moduleSha256": sha256(module.read_bytes()).hexdigest(), "bytes": module.stat().st_size,
                 "instructions": instruction_counts(module), "runtimes": {}}
        env = {**os.environ, "LC_ALL": "C"}
        env.pop("WASM_CANDIDATE", None)
        if name != "baseline":
            env["WASM_CANDIDATE"] = name
        for runtime in RUNTIMES[name]:
            command = ([python, "-B", "-m", "conformance.candidates", "--once", str(builds[name]), args.fixture]
                       if runtime == "wasmtime" else
                       ["node", str(node_script), str(builds[name]), args.fixture, "-q", "-j", "1"])
            row = measure(command, env)
            outputs = row.pop("outputs")
            if name == "baseline":
                baseline_outputs[runtime] = outputs
            row["outputEqualsBaseline"] = len(outputs) == 1 and outputs == baseline_outputs.get(runtime)
            if not row["outputEqualsBaseline"] or row["exitCodes"] != [0]:
                problems.append(f"{name} on {runtime}: exit {row['exitCodes']} or output differs from the baseline")
            entry["runtimes"][runtime] = row
            print(f"candidates: {name:8} {runtime:8} median {row['medianNs'] / 1e9:6.2f} s "
                  f"samples {[round(ns / 1e9, 2) for ns in row['samplesNs']]} exit {row['exitCodes']} {row['verdict']!r} "
                  f"equal={row['outputEqualsBaseline']}", flush=True)
        report["builds"][name] = entry
    # The ceiling for a threaded candidate: the native reference's own -j scaling on this machine (ADR 0011).
    native = BUILD / "native/cp_verify"
    if native.exists():
        sys.path.insert(0, str(ROOT))
        from conformance.memory import invocation
        call, _ = invocation(args.fixture)
        if call[-2:] != ["-j", "1"]:
            raise ValueError("expected the published call to end with -j 1")
        call = call[:-2]
        report["nativeThreads"] = {}
        for threads in sorted({1, 2, 4, os.cpu_count() or 1}):
            row = measure([str(native), *call, "-j", str(threads)], {**os.environ, "LC_ALL": "C"},
                          cwd=ROOT / ".upstream/FlashProve")
            row.pop("outputs")
            report["nativeThreads"][str(threads)] = row
            print(f"candidates: native -j {threads:<3} median {row['medianNs'] / 1e9:6.2f} s "
                  f"samples {[round(ns / 1e9, 2) for ns in row['samplesNs']]} exit {row['exitCodes']}", flush=True)
    report["problems"] = problems
    (OUT / f"report-{args.fixture}.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(f"candidates: {'all outputs equal the baseline' if not problems else 'FAILED: ' + '; '.join(problems)}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
