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

## Licence

By contributing you agree that your contribution is licensed under the Apache License, Version 2.0.
