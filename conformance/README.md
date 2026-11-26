# conformance

The corpora of SPEC.md § 5, run against the native reference built from the same pin.

- `excluded-fields.txt`: the only output fields a comparison may skip, each with its reason (R-EQ-3)
- `regressions/` (from M2): every input that once broke R-EQ-1 or R-EQ-2, with its provenance, kept forever

Fixtures are not stored here. `make upstream` fetches them and checks them against upstream's `SHA256SUMS`.
