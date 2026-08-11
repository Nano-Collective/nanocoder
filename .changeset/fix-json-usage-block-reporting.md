---
"@nanocollective/nanocoder": patch
---

Fixed the `usage` block in the `--plain --json` run report being emitted as all zeros for providers that report no token telemetry, and reading as zero total spend for providers that report input/output counts without a total. The block is now omitted entirely unless at least one token count is actually reported, and `totalTokens` falls back to input+output when the provider omits it, so downstream harnesses can distinguish "no telemetry available" from a genuine zero.
