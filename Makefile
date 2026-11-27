# flashprove-wasm-verifier. `make help` lists every target. Targets of later milestones exit 2.
.DEFAULT_GOAL := help
SEEDS ?= 1000
FUZZ_JOBS ?= 1
FUZZ_SHARD ?= 0/1

.PHONY: help bootstrap upstream check reference native-c1 build cli host-build host-test wasm-build-test wasm-audit-test wasm-io-test comparator-test m1-gate-test m1-prerequisites m1-conformance node-gate-test conformance memory-probe fuzz fuzz-test test c7-test scoped-disk-test verify-test replay-transport-test replay-test memory-limit-test bench clean

help: ## list targets
	@awk 'BEGIN{FS=":.*## "} /^[a-z0-9-]+:.*## /{printf "  %-12s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

bootstrap: ## fetch the pinned wasi-sdk and Wasmtime into .toolchain/, hashes checked
	@scripts/bootstrap.sh

upstream: ## fetch FlashProve at the pinned commit into .upstream/, examples hash-checked
	@scripts/fetch-upstream.sh

check: ## repository checks: locks, links, requirement IDs, prose
	@python3 -B scripts/check-docs.py

reference: upstream ## build the native cp_verify with upstream's build.sh (x86_64 Linux, g++ 13+)
	@scripts/build-reference.sh

native-c1: reference ## check published native whole calls, part calls and plans
	@python3 -B -m conformance.native_c1

build: bootstrap upstream ## compile the single-threaded WebAssembly module
	@scripts/build-wasm.sh

cli: build host-build ## build the local fpv command with Node 24

host-build:
	@npm ci --ignore-scripts --no-audit --no-fund
	@npm run build:host

wasm-build-test: build ## test the Wasm build digest, fallback paths and thread arguments
	@conformance/wasm-build-test.sh

wasm-audit-test: build ## test that the port audit rejects unaudited build inputs
	@python3 -B conformance/wasm-audit-test.py

wasm-io-test: build ## test the restricted Wasmtime I/O contract
	@scripts/bootstrap-wasmtime-python.sh
	@.toolchain/wasmtime-python/bin/python -B -m unittest conformance.wasmtime_io_test

comparator-test: ## test conformance output comparison rules
	@python3 -B -m unittest conformance.compare_test

m1-gate-test: ## test M1 missing evidence and mismatch handling
	@python3 -B -m unittest conformance.m1_test

m1-prerequisites: reference wasm-build-test wasm-audit-test wasm-io-test comparator-test
	@.toolchain/wasmtime-python/bin/python -B -m unittest conformance.wasmtime_stage_test

m1-conformance: ## require the port audit, C3, C4 and Wasmtime C1 part calls and plans
	+@python3 -B -m conformance.m1 "$(MAKE)"

node-gate-test: ## test the Node conformance evidence and prerequisite checks
	@python3 -B -m unittest conformance.node_differential_test

conformance: ## require M1 gates and compare Node C1, C2 and C6 with pinned native
	+@python3 -B -m conformance.node_differential "$(MAKE)"

memory-probe: m1-conformance ## measure full-size native RSS and Wasmtime stage pages
	@.toolchain/wasmtime-python/bin/python -B -m conformance.memory

fuzz: ## run C5 against pinned native with SEEDS, FUZZ_JOBS and FUZZ_SHARD
	+@python3 -B -m conformance.fuzz run --make "$(MAKE)" --seeds "$(SEEDS)" --jobs "$(FUZZ_JOBS)" --shard "$(FUZZ_SHARD)"

fuzz-test: ## check deterministic seed mapping, shard merge and mismatch replay
	@python3 -B -m unittest conformance.fuzz_test

host-test:
	@npm ci --ignore-scripts --no-audit --no-fund
	@npm test

test: memory-limit-test ## type-check and run host contracts and C7 resource faults

c7-test: test scoped-disk-test ## run the full C7 suite with native comparisons on x86_64 Linux

scoped-disk-test: build reference host-test ## compare native and guest scoped input reads on Linux
	@node conformance/cli-input-test.mjs

verify-test: build host-test ## compare verify(files, args) with native on published calls (native on x86_64 Linux)
	@node conformance/verify-test.mjs

replay-transport-test: host-test ## test Node replay events, pipes and wait status
	@scripts/bootstrap-wasmtime-python.sh
	@.toolchain/wasmtime-python/bin/python -B -c 'from pathlib import Path; import wasmtime; Path("build/node-replay-test.wasm").write_bytes(wasmtime.wat2wasm(Path("conformance/node-replay.wat").read_text()))'
	@node --test conformance/node-replay-test.mjs

replay-test: conformance replay-transport-test ## compare the Node calls and test replay transport

memory-limit-test: bootstrap replay-transport-test ## test resource faults and the process ABI in Wasm
	@bash conformance/wasm-memory-test.sh

bench: ## performance protocol R-PERF on the full-size fixtures  [M4]
	@scripts/not-yet.sh $@ M4

clean: ## remove build outputs (keeps .upstream and .toolchain)
	rm -rf build
