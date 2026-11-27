# Releasing

A release publishes the baseline module, its checksums, both locks, the npm archive, the offline demo bundle, the notices and the gate evidence, all listed in one signed `ReleaseManifestV1`. The design is [RFC-0010](docs/rfcs/RFC-0010-release.md). Versions follow the [compatibility policy](docs/spec/09-release-and-versioning.md#compatibility-policy).

## One-time setup (maintainer)

1. Create the Ed25519 signing key offline with OpenSSL 3 or later. Keep the private key off shared machines.

   ```sh
   openssl genpkey -algorithm ed25519 -out release-signing-key.pem
   openssl pkey -in release-signing-key.pem -pubout -out release/signing-key.pub.pem
   openssl pkey -pubin -in release/signing-key.pub.pem -outform DER | sha256sum
   ```

2. Store the private key as the repository secret `RELEASE_SIGNING_KEY`. Commit `release/signing-key.pub.pem`. Store its fingerprint, the DER SHA-256 above, as the repository variable `RELEASE_KEY_FINGERPRINT`.
3. Publish the same fingerprint through a channel that this repository and its releases do not control, for example the maintainer's own site. Users compare against that copy, not the one in the release.

## Each release

1. Pick a commit on `main` whose **Release gates** workflow passed. That workflow runs `make conformance`, `make c7-test`, four C5 shards of `make fuzz SEEDS=1000` and `make repro`, then `python3 -m conformance.release_gate`. If any gate fails, fix the cause in a pull request. A safety violation also needs a permanent regression under `conformance/regressions/` (CLAUDE.md, rule 2). Never retag to skip a gate.
2. Rehearse: run the **Release** workflow by hand on that commit with a prerelease version. The dry run stages, signs with a throwaway key, proves that a changed manifest fails verification, interrupts a publication and resumes it with identical bytes, and verifies the result.
3. Tag the commit `vX.Y.Z` and push the tag. The tag run repeats the dry run's checks with the real key. It creates the GitHub release as a draft, uploads every asset, verifies a fresh download against the manifest and signature, and only then publishes the release.
4. If an upload fails, rerun the job. Publication keeps assets whose bytes are identical and uploads the rest. If any published asset differs from the staged bytes, publication stops. Do not delete or replace assets: release a new version instead.

## Licence obligations

Every binary artifact ships the repository `LICENSE` and `NOTICE`, FlashProve's `NOTICE`, `LICENSE`, `THIRD_PARTY.md` and `licenses/` from the pinned commit, and the wasi-libc notices in `port/notices`. `make package` refuses an archive without them, and the release stages the same `notices/` tree. No fixture bytes enter the npm archive. The demo bundle carries the two public examples with their upstream `SHA256SUMS` provenance.

## Verifying a release (users)

```sh
gh release download vX.Y.Z --dir fpv-release   # or download the assets by hand
python3 scripts/release.py download --github-release vX.Y.Z --out fpv-release
python3 scripts/release.py verify --dir fpv-release --public-key signing-key.pub.pem --fingerprint <independently published fingerprint>
```

`verify` checks the Ed25519 signature over the exact manifest bytes, then every artifact's size and SHA-256. It rejects a file that the manifest does not list.
