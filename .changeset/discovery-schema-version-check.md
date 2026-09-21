---
"@nanocollective/nanocoder": patch
---

The VS Code discovery file's `version` field is now actually checked. It was parsed and echoed back but never compared, so the "bump on breaking changes" its constant promises would have done nothing: a `v2` file written by a newer CLI was consumed by an older extension as if it were `v1`, surfacing as a failed handshake or a misread field rather than a clean "not ready". A file declaring a newer schema is now treated as missing, which is the direction that matters given the extension and the CLI update independently. Older files, including ones written before the field existed, still load.

PID reuse in the same file's stale detection is documented as an accepted residual rather than papered over with an age cutoff. A recycled PID reads as live, but the recycled process is not listening on the recorded port and does not hold the bearer token, so the cost is one failed connection that the next `start()` repairs. An age bound would trade that self-healing transient for a worse failure mode: disconnecting a genuinely long-lived session.
