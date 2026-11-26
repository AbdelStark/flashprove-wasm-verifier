"""Compare pinned compilation and link evidence with the reviewed port inventory."""

from io import BytesIO
import json
from pathlib import Path
import re
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
SDK = ROOT / ".toolchain/wasi-sdk"
BASELINE = ROOT / "port/audit.json"
ABI = ROOT / "port/ABI.md"
VALUE_TYPES = {0x7F: "i32", 0x7E: "i64", 0x7D: "f32", 0x7C: "f64", 0x7B: "v128", 0x69: "exnref"}


def read(stream, count):
    data = stream.read(count)
    if len(data) != count:
        raise ValueError("truncated WebAssembly section")
    return data


def u32(stream):
    value = 0
    for shift in range(0, 35, 7):
        byte = read(stream, 1)[0]
        value |= (byte & 0x7F) << shift
        if not byte & 0x80 and value <= 0xFFFFFFFF:
            return value
    raise ValueError("invalid WebAssembly u32")


def name(stream):
    return read(stream, u32(stream)).decode("utf-8")


def signature(stream):
    if read(stream, 1) != b"\x60":
        raise ValueError("unaudited WebAssembly type form")
    params = [VALUE_TYPES[read(stream, 1)[0]] for _ in range(u32(stream))]
    results = [VALUE_TYPES[read(stream, 1)[0]] for _ in range(u32(stream))]
    return f"({','.join(params)})->({','.join(results)})"


def imports(module):
    types = []
    with module.open("rb") as stream:
        if read(stream, 8) != b"\0asm\x01\0\0\0":
            raise ValueError("expected a WebAssembly core module")
        while raw_id := stream.read(1):
            section_id = raw_id[0]
            payload = BytesIO(read(stream, u32(stream)))
            if section_id == 1:
                types = [signature(payload) for _ in range(u32(payload))]
            elif section_id == 2:
                entries = []
                for _ in range(u32(payload)):
                    namespace, field = name(payload), name(payload)
                    if read(payload, 1) != b"\0":
                        raise ValueError(f"unaudited non-function import {namespace}.{field}")
                    entries.append(f"{namespace}.{field} {types[u32(payload)]}")
                return sorted(entries)
            elif section_id > 2:
                break
    return []


def check_abi_documentation(reviewed, path=ABI):
    document = path.read_text(encoding="utf-8")
    if document.partition("\n")[0] != "# Guest ABI v1":
        raise ValueError("expected frozen guest ABI v1")
    entries = sorted(f"{name} {signature}" for name, signature in re.findall(
        r"^\| `([\w.]+)` \| `(\([^()`]*\)->\([^()`]*\))` \|$", document, re.MULTILINE))
    if entries != reviewed["imports"]:
        raise ValueError("documented ABI tuples differ from the reviewed imports")
    return len(entries)


def dependency_paths(depfile, cwd, work):
    # Clang's -MD output uses Make's backslash escaping and dollar doubling.
    entries = depfile.read_text().replace("\\\n", "").partition(": ")[2]
    if not entries.strip():
        raise ValueError(f"empty dependency list for {depfile.stem}")
    locations = (
        (work / "verifier/src", "upstream/verifier/src"),
        (ROOT / ".upstream/FlashProve", "upstream"),
        (SDK, "sdk"),
        (ROOT / "port", "port"),
    )
    paths = set()
    for token in re.findall(r"(?:\\.|[^\s\\])+", entries):
        path = (cwd / re.sub(r"\\(.)", r"\1", token).replace("$$", "$")).resolve()
        for base, prefix in locations:
            if path.is_relative_to(base):
                paths.add(f"{prefix}/{path.relative_to(base).as_posix()}")
                break
        else:
            raise ValueError(f"dependency outside the audited roots: {path.name}")
    return paths


def driver_flags(record, work, digest):
    command = json.loads(record.read_text().strip().removesuffix(","))
    arguments = command["arguments"]
    if Path(arguments[0]).resolve() != (SDK / "bin/clang").resolve():
        raise ValueError("compilation used a different SDK driver")
    # Clang's -MJ records these driver inputs plus OS-specific linker detection.
    flags = arguments[5:]
    if arguments[1:5] != ["-xc++", command["file"], "-o", command["output"]]:
        raise ValueError(f"unexpected compiler command for {record.stem}")
    flags = [flag for flag in flags if not flag.startswith("-mlinker-version=")]
    for required in ("-fno-fast-math", "-ffp-contract=off", "-mno-relaxed-simd"):
        if required not in flags:
            raise ValueError(f"missing strict compiler flag {required}")
    forbidden = {"-Ofast", "-ffast-math", "-funsafe-math-optimizations", "-fassociative-math",
                 "-freciprocal-math", "-ffinite-math-only", "-fapprox-func", "-mrelaxed-simd"}
    for flag in flags:
        if flag in forbidden or (flag.startswith("-ffp-contract=") and flag != "-ffp-contract=off"):
            raise ValueError(f"forbidden compiler flag {flag}")
    return [flag.replace(str(work), "<build>").replace(str(ROOT), "<root>").replace(digest, "<source-digest>")
            for flag in flags]


def c_symbols(path, kind):
    output = subprocess.check_output(
        [SDK / "bin/llvm-nm", "--format=posix", "--no-demangle", f"--{kind}-only", path],
        text=True,
    )
    return {line.split()[0] for line in output.splitlines()
            if re.fullmatch(r"(?!_Z)[A-Za-z_]\w* [A-Za-z](?: [0-9a-f]+)*", line)}


def validate_instructions(module, output):
    subprocess.run(
        [ROOT / ".toolchain/wasmtime/wasmtime", "compile", "-W", "relaxed-simd=n", "-W", "threads=n",
         "-O", "opt-level=0", "-o", output, module],
        check=True, capture_output=True, text=True,
    )


def memory_limits(module):
    with module.open("rb") as stream:
        if read(stream, 8) != b"\0asm\x01\0\0\0":
            raise ValueError("expected a WebAssembly core module")
        while section := stream.read(1):
            size = u32(stream)
            if section == b"\x05":
                payload = BytesIO(read(stream, size))
                if u32(payload) != 1 or u32(payload) != 1:
                    raise ValueError("expected one unshared wasm32 memory with a declared maximum")
                limits = [str(u32(payload)), str(u32(payload))]
                if payload.read(1):
                    raise ValueError("unexpected memory section data")
                return limits
            stream.seek(size, 1)
    raise ValueError("missing guest memory")


def growth_sites(module):
    sites = []
    function = ""
    with subprocess.Popen([SDK / "bin/llvm-objdump", "-d", module], stdout=subprocess.PIPE, text=True) as proc:
        for line in proc.stdout:
            symbol = re.fullmatch(r"[0-9a-f]+ <([^>]+)>:\n", line)
            if symbol:
                function = symbol[1]
            if "\tmemory.grow\t" in line:
                sites.append(function)
        if proc.wait():
            raise ValueError("could not audit WebAssembly growth instructions")
    if sites != ["sbrk"]:
        raise ValueError("unexpected memory.grow sites")
    return sites


def check_inventory(observed, reviewed):
    for key, current in observed.items():
        approved = reviewed[key]
        if current == approved:
            continue
        added = sorted(set(current) - set(approved))
        removed = sorted(set(approved) - set(current))
        changes = [*(f"+ {entry}" for entry in added), *(f"- {entry}" for entry in removed)]
        raise ValueError(f"{key} differs from the reviewed inventory\n" + "\n".join(changes or ["ordered entries changed"]))


def main():
    path, digest, report, *link = sys.argv[1:]
    work = Path(path).resolve()
    module = work / "cp_verify.wasm"
    observed = {"link_flags": link}
    dependencies = set()
    direct = set()
    for unit in ("cp_verify", "baseline", "process", "memory"):
        dependencies.update(dependency_paths(work / f"{unit}.d", work / "verifier/src", work))
        observed[f"{unit}_flags"] = driver_flags(work / f"{unit}.command.json", work, digest)
        direct.update(c_symbols(work / f"{unit}.o", "undefined"))
    linked = c_symbols(module, "defined")
    if {"madvise", "posix_madvise"} & (direct | linked):
        raise ValueError("the optional page-residency advice must compile out")
    observed.update(dependencies=sorted(dependencies), direct_c_symbols=sorted(direct),
                    linked_c_symbols=sorted(linked), imports=imports(module), memory_limits=memory_limits(module),
                    memory_growth=growth_sites(module))
    Path(report).write_text(json.dumps(observed, indent=2) + "\n")
    reviewed = json.loads(BASELINE.read_text())
    documented = check_abi_documentation(reviewed)
    check_inventory(observed, reviewed)
    validate_instructions(module, work / "audit.cwasm")
    print(f"wasm audit: {len(dependencies)} dependencies, {len(direct | linked)} C symbols, "
          f"{len(observed['imports'])} typed imports")
    print(f"ABI v1: {documented} documented tuples match the linked module")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        raise SystemExit(f"wasm audit: {error.stderr or error}") from error
    except (OSError, ValueError, KeyError, IndexError) as error:
        raise SystemExit(f"wasm audit: {error}") from error
