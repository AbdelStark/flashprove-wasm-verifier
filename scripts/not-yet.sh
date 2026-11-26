#!/usr/bin/env bash
# not-yet.sh <target> <milestone>: the honest answer of a target that does not exist yet.
echo "make $1: not built yet. It arrives with $2 (SPEC.md § 8)." >&2
exit 2
