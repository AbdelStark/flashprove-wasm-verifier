"""Exercise the same audit checks used before the serving module is installed."""

import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import audit_wasm as audit


def reject(change, reason):
    try:
        change()
    except (ValueError, subprocess.CalledProcessError) as error:
        output = error.stderr if isinstance(error, subprocess.CalledProcessError) else str(error)
        if reason in output:
            print(f"wasm audit test: rejected {reason}")
            return
        raise
    raise SystemExit(f"wasm audit test: expected failure for {reason}")


def main():
    reviewed = json.loads(audit.BASELINE.read_text())
    build = audit.ROOT / "build"
    actual = json.loads((build / "wasm/audit-observed.json").read_text())
    audit.check_inventory(actual, reviewed)
    digest = (build / "wasm/source.sha256").read_text().strip()

    with TemporaryDirectory(dir=build) as directory:
        work = Path(directory)
        docs = work / "ABI.md"
        docs.write_text(audit.ABI.read_text().replace(
            "`fpv_port.pipe` | `(i32)->(i32)`", "`fpv_port.pipe` | `(i64)->(i32)`"))
        reject(lambda: audit.check_abi_documentation(reviewed, docs), "documented ABI tuples differ")
        cwd = work / "verifier/src"
        cwd.mkdir(parents=True)
        (cwd / "audit-extra.h").write_text('extern "C" int extra(int)\n'
                                            '__attribute__((import_module("audit_probe"), import_name("extra")));\n')
        src = cwd / "audit-probe.cpp"
        src.write_text('#include "audit-extra.h"\n#include <sys/mman.h>\n'
                       '#ifdef MADV_POPULATE_WRITE\n#error unexpected memory advice\n#endif\n'
                       'int main() { return extra(42); }\n')
        depfile = work / "probe.d"
        command = work / "probe.command.json"
        compiler = audit.SDK / "bin/wasm32-wasip1-clang++"
        common = [compiler, "-fno-fast-math", "-ffp-contract=off", "-mno-relaxed-simd",
                  f"-I{audit.ROOT / 'port/include'}", src]
        module = work / "probe.wasm"
        subprocess.run([*common, "-MD", "-MT", "probe", "-MF", depfile, "-o", module], check=True)

        added = audit.dependency_paths(depfile, cwd, work)
        dependencies = sorted(set(actual["dependencies"]) | added)
        reject(lambda: audit.check_inventory({"dependencies": dependencies}, reviewed),
               "+ upstream/verifier/src/audit-extra.h")

        imports = sorted(set(actual["imports"]) | set(audit.imports(module)))
        reject(lambda: audit.check_inventory({"imports": imports}, reviewed), "+ audit_probe.extra (i32)->(i32)")

        for flag in ("-ffast-math", "-ffp-contract=fast", "-mrelaxed-simd", "-DTEST_BUILD=1"):
            subprocess.run([*common, flag, "-MJ", command, "-c", "-o", work / "probe.o"], check=True)
            if flag == "-DTEST_BUILD=1":
                flags = audit.driver_flags(command, work, digest)
                reject(lambda: audit.check_inventory({"cp_verify_flags": flags}, reviewed), "+ TEST_BUILD=1")
            else:
                reject(lambda: audit.driver_flags(command, work, digest), f"forbidden compiler flag {flag}")

        wat = work / "relaxed.wat"
        wat.write_text('(module (func (param v128 v128 v128) (result v128)\n'
                       '  local.get 0 local.get 1 local.get 2 f32x4.relaxed_madd))\n')
        reject(lambda: audit.validate_instructions(wat, work / "relaxed.cwasm"), "relaxed SIMD")

        grow = cwd / "uncontrolled-grow.cpp"
        grow.write_text('int main(int argc, char **) { return __builtin_wasm_memory_grow(0, argc); }\n')
        uncontrolled = work / "uncontrolled-grow.wasm"
        subprocess.run([compiler, grow, "-o", uncontrolled], check=True)
        reject(lambda: audit.growth_sites(uncontrolled), "unexpected memory.grow sites")
        reject(lambda: audit.memory_limits(uncontrolled), "declared maximum")


if __name__ == "__main__":
    main()
