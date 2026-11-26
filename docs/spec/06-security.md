# Security

## Trust boundaries

| Boundary | Invariant | Failure evidence |
|---|---|---|
| Build supply chain | Verify source revision, example checksums and archives. Record source and module digests separately. | Dirty or wrong-pin checkout and altered archive fail the build. |
| Caller to host | Treat arguments, paths, input bytes and provider output as untrusted. Caller independently holds request, reply, ID and policy. | Namespace and acceptance negative tests reject substitutions. |
| Guest to runtime | Restrict imports, bound guest pointers and counts, expose immutable files and keep file descriptors local. | Invalid guest ranges and unsupported imports fail closed. |
| Stage to parent | Fresh memory, matched replay and checked descriptor transport. Parent alone interprets stage output. | Fork divergence or child fault cannot produce a publishable pass. |
| Browser bundle | Hash module bytes against the trusted release manifest before compilation. Serve and verify assets through a trusted deployment. | Changed module bytes cause integrity failure. |
| Release identity | Sign the manifest and verify against an independently distributed maintainer public key. | A changed manifest or asset fails independent verification. |

**Pass safety.** System errors and hostile inputs cannot turn a native refusal into a pass. Independent differential runs catch discrepancies on given inputs. They do not establish a universal proof of equivalence. A change that weakens a check cannot enter a release.

**Capability confinement.** The guest receives no ambient filesystem, network, credentials, environment or randomness. A CLI directory capability grants the named files under it through the checked adapter. Public inputs only. Browser execution cannot promise process-dump protection. Every call discards guest memories and file snapshots when the supervising task ends.

**Secrets.** The runtime takes no secrets. Release signing credentials live in a maintainer-controlled release environment, with writing credentials available only to the publication job. Untrusted pull-request jobs use read-only access. Capture neither secrets nor raw input in CI by default.

## Response

Use the [private reporting path](../../SECURITY.md) for unexpected passes, host fail-open behavior, reproducibility failures and wrong module loads. Coordinate upstream issues with upstream. Add a minimal permanent regression after disclosure. Repository fixtures stay untracked. [Limits](08-performance-budget.md#resource-envelope) · [Regression protocol](../rfcs/RFC-0006-conformance.md#proposed-design)
