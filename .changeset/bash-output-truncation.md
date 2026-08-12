---
"@nanocollective/nanocoder": patch
---

`execute_bash` and custom tools now truncate long output by keeping both the head and the tail (tail-weighted) instead of only the head, so the actionable part of compiler/test-runner output (error list, failure summary, exit status) — which usually lands at the end — isn't discarded.
