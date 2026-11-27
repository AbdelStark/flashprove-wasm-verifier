# Contributing

Start with the current milestone gate in the v1 specification. Use the requirement IDs and RFC linked by the implementation issue.

## Where to start

1. Read [SPEC.md](SPEC.md). Read the [milestones](SPEC.md#8-milestones) and [open questions](SPEC.md#9-open-questions).
2. Read [AGENTS.md](AGENTS.md). It holds the rules for people and coding agents alike.
3. Run `make help`, then `make bootstrap upstream check`.

Good first contributions, now:

- challenge a requirement: is something too weak, too strong, or missing?
- answer an open question with the evidence its RFC requires
- extend the [port audit](docs/spec/01-architecture.md#port-audit) with a dependency and its check

## Pull requests

- One concern per pull request. Name the requirement IDs it serves.
- On the verification path, include what you ran and what it printed: `make conformance`, `make fuzz SEEDS=1000`, verdict counts, mismatches.
- A requirement change updates the spec and affected RFCs. Lowering one needs an ADR under the [change policy](SPEC.md#10-changing-this-spec).
- A change to a pin needs an ADR and a full conformance run (AGENTS.md, rule 5).
- Speed claims follow R-PERF-1, or they stay out.

## Checks before a pull request

- `make check` is the docs and lock gate. It downloads nothing. It checks lock keys and digests, relative links and their heading anchors, requirement IDs against SPEC.md, `ADR NNNN` references, RFC titles, metadata and sections, ADR titles and status lines, milestone names in RFCs and the roadmap, em and en dashes, and the documented guest ABI. `scripts/check_docs_test.py` keeps a regression case for each rule.
- Compatibility: a change to the CLI behavior, the TypeScript exports or the result types follows the [compatibility policy](docs/spec/09-release-and-versioning.md#compatibility-policy). ABI, worker messages and report schemas carry their own versions; bump the version instead of changing a shape in place.
- Licences: a new dependency states its source, pin, verification method and licence in the [dependency policy](docs/spec/09-release-and-versioning.md#dependency-policy). Anything that ends up in a binary artifact also ships its notice. `make package` refuses an archive without the required notices or with fixture bytes.
- Releases: follow [RFC-0010](docs/rfcs/RFC-0010-release.md). Release artifacts are built only from pinned inputs and checked before they are signed.

## Licence

By contributing you agree that your contribution is licensed under the Apache License, Version 2.0.
