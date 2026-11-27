# Offline demo

A static page that verifies the two small published FlashProve proofs in the browser and shows the verdict, what was checked and the caller-acceptance decision as separate results (R-API-2, R-API-3).

`make demo` writes the bundle to `build/demo`: `index.html`, `demo.js`, `worker.js`, `cp_verify.wasm`, `manifest.json` and `fixtures/`. The script checks every fixture file against upstream's `SHA256SUMS` and the module against the audited build checksum. The manifest records the upstream commit, the module SHA-256, the source build digest and each file's SHA-256. Fixture bytes are generated, never committed.

At load the page fetches the manifest, the module, the worker and every fixture file, and checks each fixture digest. The module and worker are then served from blob URLs, so verification needs no network. `createVerifier` checks the module digest again before compiling.

Serve the directory over HTTP. Browsers restrict `fetch` and workers on `file:` URLs, so opening `index.html` directly does not work.

```sh
make demo
python3 -m http.server --bind 127.0.0.1 --directory build/demo 8000
```

Then open http://127.0.0.1:8000 and, if you like, turn the network off. Keyboard: Tab to the proof choice, arrow keys to choose, Tab to Verify, Enter or Space to run. Status changes are announced through a polite live region.

The acceptance expectations come from the published example and the manifest, as a stand-in for values a real caller holds before it sends a prompt. The demo counts proof of work and accepts the theorem on codes, because both examples need them. The full-size examples are not in the demo: their request stage needs about 3.5 GiB of linear memory, which browsers may refuse.

`make demo-test` runs the bundle in Chromium, turns the network off after loading, verifies both examples by keyboard and fails on any request that leaves the page.
