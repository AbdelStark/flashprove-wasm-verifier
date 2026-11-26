# RFC-0010: Publish reproducible and signed release artifacts

- Status: Accepted
- Authors: @AbdelStark
- Created: 2026-11-26
- Target milestone: M5

## Summary

Publish an installable package and offline bundle only after building identical module bytes twice and verifying release signatures, contents and conformance evidence.

## Motivation

A matching `build=` value identifies sources but does not attest to the compiled artifact. R-BLD-1 and R-BLD-4 require a reproducible build and independently checkable release.

## Goals

- Publish artifact checksums, both build pins and a signed manifest.
- Require green native differential CI and an independent package verification.
- Exercise the upstream pin-update process before v1.

## Non-Goals

- Rewriting a released tag or claiming binaries are reproducible across toolchain pins.
- Prioritizing a registry release over the verified artifacts.

## Proposed Design

Build twice from the same release commit in clean roots with different absolute paths. Fix locale, build input order and source path remapping. Keep dependency caches separate from build outputs. Compare module bytes with `cmp` and report both SHA-256 values. Reject output drift even if both versions pass fixtures.

CI runs required `check`, baseline conformance and fuzz jobs using the native oracle. Build and test on the declared compatibility matrix, with exact runtime versions in evidence. Untrusted jobs can build and compare packages using read-only privileges. A protected tag release job checks the same commit's successful gates, creates the distribution files and validates every entry in `ReleaseManifestV1`. All artifact hashes cover final bytes. The manifest excludes itself and its detached signature. Sign exact manifest bytes with Ed25519 and publish the detached signature and key fingerprint; publish the verification key through the project's independently authenticated maintainer channel. Use OpenSSL 3 with Ed25519 support for the release command and record the exact version.

Stage the package archive and static bundle under `build/`. Include license and required notices. No fixture bytes enter the library archive. The demo archive may contain the separately verified public demo artifacts and their provenance. Test the extracted archive with network disabled after dependencies and assets are provisioned. Verify registry tag and asset hashes after publication. A rerun resumes only when every existing asset for the version has identical bytes. A mismatch stops publication.

The docs gate validates relative paths and anchors, requirement IDs, RFC metadata, ADR references and milestone references. Update contributor and release instructions with exact gate commands, failure actions and license obligations. Require one isolated pin rehearsal with an ADR, refreshed audit and full comparison. An incompatible candidate pin is recorded as such and is not promoted.

## Alternatives Considered

- Publish only a source digest. It does not identify toolchain or module bytes.
- Use unsigned checksums from the same download. Replacing both files could defeat the check.
- Use rolling version tags. Consumers could silently receive different bits.

## Drawbacks

- Two clean builds and full differential CI extend release preparation.
- Independent key distribution and partial publication recovery add maintainer work.

## Migration / Rollout

Bring deterministic build flags in through normal build PRs. Use a dry-run release and verify a staged archive before issuing the first stable tag. Mark deprecated or revoked versions using the release policy.

## Testing Strategy

Build in two clean paths, compare byte-for-byte and fail a deliberately altered module. Verify the staged manifest with the public key, reject changed manifest and asset bytes, and check lockfile hashes. Install the archive on supported runtimes. Verify the demo offline and rehearse retrying a partial upload with the same version and outputs.

## Open Questions

None. Maintainer release credentials and signing key provisioning are deliverables of M5.

## References

[Release policy](../spec/09-release-and-versioning.md) · [Release schema](../spec/03-data-model.md#artifact-versions) · [Build requirements](../../SPEC.md#49-build) · [License and notices](../../NOTICE)
