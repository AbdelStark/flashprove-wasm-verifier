# flashprove-wasm-verifier. `make help` lists every target. Targets of later milestones exit 2.
.DEFAULT_GOAL := help
SEEDS ?= 1000

.PHONY: help bootstrap upstream check reference native-c1 build cli wasm-build-test wasm-audit-test wasm-io-test comparator-test m1-gate-test m1-prerequisites conformance memory-probe fuzz test scoped-disk-test replay-transport-test replay-test memory-limit-test bench clean

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

cli: build ## build the local fpv command with Node 24
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

conformance: ## require the port audit, C3, C4 and Wasmtime C1 part calls and plans
	+@python3 -B -m conformance.m1 "$(MAKE)"

memory-probe: conformance ## measure full-size native RSS and Wasmtime stage pages
	@.toolchain/wasmtime-python/bin/python -B -m conformance.memory

fuzz: ## corpus C5: SEEDS seeded mutations, wasm vs native  [M2]
	@scripts/not-yet.sh $@ M2

test: ## type-check the TypeScript host and run its contract tests
	@npm ci --ignore-scripts --no-audit --no-fund
	@npm test

scoped-disk-test: build reference test ## compare native and guest scoped input reads on Linux
	@node conformance/cli-input-test.mjs

replay-transport-test: test ## test Node replay events, pipes and wait status
	@scripts/bootstrap-wasmtime-python.sh
	@.toolchain/wasmtime-python/bin/python -B -c 'from pathlib import Path; import wasmtime; Path("build/node-replay-test.wasm").write_bytes(wasmtime.wat2wasm(Path("conformance/node-replay.wat").read_text()))'
	@node --test conformance/node-replay-test.mjs

replay-test: conformance replay-transport-test ## compare Node whole calls with the pinned native reference
	@python3 -B -m conformance.node_replay_c1

memory-limit-test: bootstrap replay-transport-test ## test resource faults and the process ABI in Wasm
	@bash conformance/wasm-memory-test.sh

bench: ## performance protocol R-PERF on the full-size fixtures  [M4]
	@scripts/not-yet.sh $@ M4

clean: ## remove build outputs (keeps .upstream and .toolchain)
	rm -rf build
