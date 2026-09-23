---
"@nanocollective/nanocoder": patch
---

`nanocoder run` now exits with code 1 when the run fails: a provider or connection error, or a stop by `nanocoder.retries` (repeated tool calls, empty responses, malformed tool calls). It exited 0 in every one of those cases, because it looked for an error-role message that nothing ever produces, so CI could not tell a failed run from a finished one. `--plain` already reported these correctly.
