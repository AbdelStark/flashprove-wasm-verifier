# flashprove-wasm-verifier. `make help` lists every target. Targets of later milestones exit 2.
.DEFAULT_GOAL := help
SEEDS ?= 1000

.PHONY: help bootstrap upstream check reference native-c1 build wasm-build-test wasm-audit-test conformance fuzz test bench clean

help: ## list targets
	@awk 'BEGIN{FS=":.*## "} /^[a-z-]+:.*## /{printf "  %-12s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

bootstrap: ## fetch the pinned wasi-sdk and Wasmtime into .toolchain/, hashes checked
	@scripts/bootstrap.sh

upstream: ## fetch FlashProve at the pinned commit into .upstream/, examples hash-checked
	@scripts/fetch-upstream.sh

check: ## repository checks: locks, links, requirement IDs, prose
	@python3 scripts/check-docs.py

reference: upstream ## build the native cp_verify with upstream's build.sh (x86_64 Linux, g++ 13+)
	@scripts/build-reference.sh

native-c1: reference ## check published native whole calls, part calls and plans
	@python3 conformance/native-c1.py

build: bootstrap upstream ## compile the single-threaded WebAssembly module
	@scripts/build-wasm.sh

wasm-build-test: build ## test the Wasm build digest, fallback paths and thread arguments
	@conformance/wasm-build-test.sh

wasm-audit-test: build ## test that the port audit rejects unaudited build inputs
	@python3 -B conformance/wasm-audit-test.py

conformance: ## corpora C1 to C4 and C6 against the native reference  [M1, M2]
	@scripts/not-yet.sh $@ M1

fuzz: ## corpus C5: SEEDS seeded mutations, wasm vs native  [M2]
	@scripts/not-yet.sh $@ M2

test: ## host unit tests  [M2]
	@scripts/not-yet.sh $@ M2

bench: ## performance protocol R-PERF on the full-size fixtures  [M4]
	@scripts/not-yet.sh $@ M4

clean: ## remove build outputs (keeps .upstream and .toolchain)
	rm -rf build
