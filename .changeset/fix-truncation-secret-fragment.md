---
"@nanocollective/nanocoder": patch
---

Truncated tool output no longer leaks part of a secret. Bash output is cut to fit before scrubbing runs, and a cut through the middle of a key left a fragment such as `sk-live-abcdef1234` that no detector recognises, so it went to the provider even with scrubbing on. Cuts now avoid splitting whitespace-separated tokens, so a secret is either kept whole, where it gets scrubbed, or dropped entirely.
