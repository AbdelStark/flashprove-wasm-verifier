# Error model

## Native results

These results come from the pinned call with no host fault. Preserve its output and precedence, including argument validation and the order in which a call reads files.

| Exit | Result |
|---|---|
| 0 | Whole call, `YES` or `WITHIN LIMITS: ...` |
| 1 | Native rejection, `NO: ...` |
| 2 | Native usage or input error |
| 3 | `PART PASSED: key` or `PART PASSED: leaf` |
| 4 | `PLAN ONLY: no proof was checked` |
| 5 | Native `NOT CHECKED: ...` |
| 14 | `NOT-A-VERIFICATION` |
| 15 | Native output could not be written |

A native rejection can outrank a native stage failure. The host does not change a native result solely because it contains the upstream internal status. [Native precedence](https://github.com/anthropics/FlashProve/blob/9e2bdd8ff5bf9c62f18263d7dac189b0400b260c/verifier/docs/output.md#exit-codes)

## Host failures

**Failure latch.** The first observed host fault marks the call irrevocably failed. Return exit 5 and exactly `NOT CHECKED: internal-stage\n` on stdout with no parsed record. Capture only bounded, redacted diagnostics. Apply the same terminal result to a host trap even when an upstream child would otherwise give a native rejection. Keep the difference visible in conformance.

| Failure | Response |
|---|---|
| Admission, file, total input, output, instance or elapsed time limit | Stop the run, release the reservation and use the failure latch |
| Guest trap, allocation failure or import protocol failure | Trap or signal the affected guest, latch, tear down instances |
| Replay mismatch | Do not enter the requested child branch. Latch and abort. |
| Worker error, invalid message or early exit | Supervisor returns the failure result |
| Module hash mismatch or unsupported features | Stop before instantiation and return the failure result |
| Unexpected malformed terminal output or host exception | Latch before publishing any pass |
| CLI sink fails | Exit 15 for the failed delivery. The consumer must require the exit and intact output. |
| Process or page disappears | No result can be delivered. A caller treats missing or incomplete delivery as unproved. |

Missing, nonregular and unreadable disk inputs are visible as ordinary input errors in native read order when representable. Invalid public API arguments fail with a typed host failure. Truncation within host limits follows upstream rejection semantics. There are no automatic retries for a verifier call. The caller may retry transient host failures with the same independently held inputs and must evaluate the new result on its own. [Failure design](../rfcs/RFC-0005-failure-boundary.md#proposed-design)
