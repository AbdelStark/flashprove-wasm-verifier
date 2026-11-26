"""Measure full-size fixture resources through the upstream whole-call path."""

from hashlib import sha256
from importlib.metadata import version
import json
import os
from pathlib import Path
import platform
import signal
from statistics import median
import subprocess
import sys
from tempfile import mkdtemp
from time import monotonic_ns

from conformance.compare import Case, RunResult, compare
from conformance.evidence import write_json
from conformance.native_c1 import BUILD, FIXTURES, ROOT, UPSTREAM, cases
from host.wasmtime.stages import FAILED, PartRunner


MODULE = BUILD / "wasm/cp_verify.wasm"
NATIVE = BUILD / "native/cp_verify"
SOURCES = ("config/policy.txt", "config/KL.bin", "config/layout.txt", "ivk/key.bin",
           "ivk/leaf/0.bin", "example.req", "example.y", "example.proof")
FAMILIES = ("full-size", "full-size-clipped-gap")
STAGES = ("key", "leaf", "request")
PAGE = 1 << 16
PARENT_PAGES = 2048
CHILD_PAGES = 57344
FILE_BYTES = 64 << 20
INPUT_BYTES = 128 << 20
DEADLINE_SECONDS = 600


def linux_kib(path, field):
    for line in Path(path).read_text().splitlines():
        if line.startswith(field + ":"):
            return int(line.split()[1]) * 1024
    raise ValueError(f"missing Linux memory counter {field}")


def invocation(family):
    _, args, _, verdict = next(cases(f"examples/{family}", FIXTURES[family]))
    return [*args, "-j", "1"], verdict


def snapshot(family):
    base = f"examples/{family}"
    files = {}
    retained = 0
    for name in SOURCES:
        path = UPSTREAM / base / name
        with path.open("rb") as file:
            data = file.read(min(FILE_BYTES, INPUT_BYTES - retained) + 1)
        if len(data) > FILE_BYTES or len(data) > INPUT_BYTES - retained:
            raise ValueError("fixture input exceeds the probe limit")
        files[f"/{base}/{name}".encode()] = data
        retained += len(data)
    return files, retained


def guest(family, work, pages):
    args, _ = invocation(family)
    files, input_bytes = snapshot(family)
    samples = {}

    def observe(fork, event, count):
        stage = "parent" if fork is None else STAGES[fork.ordinal]
        sample = samples.setdefault(stage, {})
        if event in ("before", "start"):
            sample[f"{event}VmSizeBytes"] = linux_kib("/proc/self/status", "VmSize")
        if event == "end":
            sample["peakLinearPages"] = count

    runner = PartRunner(MODULE, max_pages=pages, parent_pages=PARENT_PAGES, observe=observe)
    result = runner._run(tuple(arg.encode() for arg in ("cp_verify", *args)), files, stages=len(STAGES))
    (work / "guest.stdout").write_bytes(result.stdout)
    (work / "guest.stderr").write_bytes(result.stderr)
    write_json(work / "guest.json", {
        "status": result.status, "stages": samples, "snapshotBytes": input_bytes,
        "processPeakVirtualBytes": linux_kib("/proc/self/status", "VmPeak"),
        "processPeakRssBytes": linux_kib("/proc/self/status", "VmHWM"),
    })


def launch(command, work, label, **kwargs):
    begin = monotonic_ns()
    with (work / f"{label}.stdout").open("wb") as stdout, (work / f"{label}.stderr").open("wb") as stderr:
        with subprocess.Popen(command, start_new_session=True, stdout=stdout, stderr=stderr, **kwargs) as process:
            try:
                status = process.wait(timeout=DEADLINE_SECONDS)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
                raise ValueError(f"{label} exceeded the measurement deadline") from None
    return status, monotonic_ns() - begin


def outputs(work, label, status):
    return RunResult(status, (work / f"{label}.stdout").read_bytes(), (work / f"{label}.stderr").read_bytes())


def measure_native(args, probe, work):
    with (work / "native.rss").open("w+") as file:
        fd = file.fileno()
        env = {"LC_ALL": "C", "LD_PRELOAD": str(probe), "FPV_MEMORY_FD": str(fd)}
        status, elapsed = launch([NATIVE, *args], work, "native", cwd=UPSTREAM, env=env, pass_fds=(fd,))
        file.seek(0)
        rows = [line.split() for line in file]
    if [row[0] for row in rows] != ["child", "child", "child", "parent"]:
        raise ValueError("native RSS probe did not report the three stage waits and the parent")
    rss = {stage: int(row[1]) * 1024 for stage, row in zip((*STAGES, "parent"), rows)}
    if min(rss.values()) <= 0:
        raise ValueError("invalid native RSS sample")
    return outputs(work, "native", status), {"elapsedNs": elapsed, "peakRssBytesByProcess": rss}


def measure_guest(family, work, pages):
    command = [sys.executable, "-B", "-m", "conformance.memory", "--guest", family, str(work), str(pages)]
    status, elapsed = launch(command, work, "guest-worker", cwd=ROOT)
    if status:
        raise ValueError(f"Wasmtime worker failed. See {work}")
    report = json.loads((work / "guest.json").read_text())
    return outputs(work, "guest", report["status"]), {"elapsedNs": elapsed, **report}


def measure(probe, family, destination):
    args, verdict = invocation(family)
    samples = {"native": [], "wasmtime": []}
    for attempt in ("warmup", "1", "2", "3"):
        work = destination / family / attempt
        work.mkdir(parents=True)
        native, rss = measure_native(args, probe, work)
        guest_result, guest_sample = measure_guest(family, work, CHILD_PAGES)
        expected = f"{verdict}\n".encode()
        if native.status != 0 or native.stdout.splitlines(keepends=True)[-1:] != [expected]:
            raise ValueError(f"{family}: native oracle missed the expected outcome. See {work}")
        result = compare(native, guest_result, Case(f"{family}/whole", "C1", "whole"))
        write_json(work / "comparison.json", result)
        if not result["equal"] or result["safetyViolation"]:
            raise ValueError(f"{family}: native and Wasmtime disagree at {result['firstDifference']}. See {work}")
        stages = guest_sample["stages"]
        if set(stages) != {"parent", *STAGES} or any(
            not 0 < sample["peakLinearPages"] <= (PARENT_PAGES if name == "parent" else CHILD_PAGES)
            for name, sample in stages.items()
        ):
            raise ValueError(f"{family}: missing or invalid stage pages. See {work}")
        if attempt != "warmup":
            samples["native"].append(rss)
            samples["wasmtime"].append(guest_sample)
        print(f"memory: {family} {attempt} exit=0 {verdict}; closing record matched", flush=True)

    work = destination / family / "constrained"
    work.mkdir()
    constrained, cap_sample = measure_guest(family, work, 8192)
    if ((constrained.status, constrained.stdout, constrained.stderr) != (5, FAILED, b"")
            or "request" not in cap_sample["stages"] or "peakLinearPages" not in cap_sample["stages"]["request"]):
        raise ValueError(f"{family}: the constrained request did not fail closed. See {work}")
    print(f"memory: {family} constrained request exit=5 NOT CHECKED: internal-stage", flush=True)
    args[args.index("-id") + 1] = "<pinned ID.txt>"
    return {
        "fixtureManifestSha256": sha256((UPSTREAM / "examples" / family / "SHA256SUMS").read_bytes()).hexdigest(),
        "args": args, "exitCode": 0, "verdict": verdict, "samples": samples, "closingRecordMatched": True,
        "medianNs": {runtime: median(row["elapsedNs"] for row in rows) for runtime, rows in samples.items()},
        "constrained": {"childPages": 8192, "exitCode": constrained.status, "verdict": "NOT CHECKED: internal-stage",
                        "requestPeakLinearPages": cap_sample["stages"]["request"]["peakLinearPages"]},
    }


def main():
    if (platform.system(), platform.machine()) != ("Linux", "x86_64"):
        raise SystemExit("memory: requires the pinned x86_64 Linux native reference")
    out = BUILD / "memory"
    out.mkdir(exist_ok=True)
    destination = Path(mkdtemp(prefix="run-", dir=out))
    probe = destination / "memory-wait.so"
    subprocess.run(["cc", "-shared", "-fPIC", "-O2", "-Wall", "-Wextra", "-Werror",
                    str(Path(__file__).with_name("memory-wait.c")), "-o", probe], check=True)
    cpu = next(line.split(":", 1)[1].strip() for line in Path("/proc/cpuinfo").read_text().splitlines()
               if line.startswith("model name"))
    report = {
        "schema": 1, "machine": "GitHub-hosted runner" if os.environ.get("GITHUB_ACTIONS") == "true" else "Linux host",
        "os": platform.platform(), "cpu": cpu, "logicalCpus": os.cpu_count(),
        "ramBytes": linux_kib("/proc/meminfo", "MemTotal"), "runtime": {"name": "wasmtime", "version": version("wasmtime")},
        "upstreamCommit": subprocess.check_output(["git", "-C", UPSTREAM, "rev-parse", "HEAD"], text=True).strip(),
        "toolchainSha256": sha256((ROOT / "toolchain.lock").read_bytes()).hexdigest(),
        "moduleSha256": sha256(MODULE.read_bytes()).hexdigest(), "nativeSha256": sha256(NATIVE.read_bytes()).hexdigest(),
        "nativeCompiler": subprocess.check_output(["g++", "--version"], text=True).splitlines()[0],
        "scope": "fresh process through exit, including file reads, Wasmtime compilation and stage replay",
        "timer": "monotonic_ns", "warmupCount": 1, "pageBytes": PAGE,
        "parentPages": PARENT_PAGES, "childPages": CHILD_PAGES, "fileBytes": FILE_BYTES,
        "totalInputBytes": INPUT_BYTES, "deadlineSeconds": DEADLINE_SECONDS,
        "fixtures": {family: measure(probe, family, destination) for family in FAMILIES},
    }
    write_json(destination / "report.json", report)
    print(f"memory: report {destination.relative_to(ROOT)}/report.json")


if __name__ == "__main__":
    if len(sys.argv) == 5 and sys.argv[1] == "--guest" and sys.argv[2] in FAMILIES:
        guest(sys.argv[2], Path(sys.argv[3]), int(sys.argv[4]))
    elif len(sys.argv) == 1:
        main()
    else:
        raise SystemExit("memory: invalid probe arguments")
