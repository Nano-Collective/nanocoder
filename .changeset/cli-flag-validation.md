---
"@nanocollective/nanocoder": patch
---

Reject invalid CLI option values and unknown options instead of ignoring them. `--vscode-port` now accepts only an integer from 1 to 65535, so `abc`, `99999` and `8080abc` exit with `Invalid --vscode-port value` instead of quietly using a random port. `nanocoder init` and `nanocoder review` now reject unknown options with the same `Unknown option "--bogus"` error as the top-level command, instead of initialising a project or reporting a misleading extra review target. Negative numbers are read as option values, so `--context-max -5` reports an invalid context length instead of `Unknown option "-5"`. Closes #1939.
