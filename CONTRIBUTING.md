# Contributing

Thanks for looking. The project is at the spec stage, which makes this the best time to change its direction.

## Where to start

1. Read [SPEC.md](SPEC.md). Milestones are in § 8, open questions in § 9.
2. Read [AGENTS.md](AGENTS.md). It holds the rules for people and coding agents alike.
3. Run `make help`, then `make bootstrap upstream check`.

Good first contributions, now:

- challenge a requirement: is something too weak, too strong, or missing?
- answer an open question with evidence (SPEC.md § 9)
- extend the port audit: find a platform dependency the table misses (SPEC.md § 6)

## Pull requests

- One concern per pull request. Name the requirement IDs it serves.
- On the verification path, include what you ran and what it printed: `make conformance`, `make fuzz SEEDS=1000`, verdict counts, mismatches.
- A change to a requirement edits SPEC.md. Lowering one needs an ADR (SPEC.md § 10).
- A change to a pin needs an ADR and a full conformance run (AGENTS.md, rule 5).
- Speed claims follow R-PERF-1, or they stay out.

## Licence

By contributing you agree that your contribution is licensed under the Apache License, Version 2.0.
