---
"@nanocollective/nanocoder": patch
---

Custom tools may now set `timeout_ms` up to two hours (7200000) instead of five minutes, so long builds and test suites can run as custom tools. The error for a value over the cap states the limit.
