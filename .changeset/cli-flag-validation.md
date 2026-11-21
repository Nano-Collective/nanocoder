---
"@nanocollective/nanocoder": patch
---

Reject invalid CLI option values and unsupported options instead of ignoring them. `--vscode-port` now requires an integer from 1 to 65535: `abc`, `99999`, `8080abc`, an empty value and a missing value all exit with an error instead of quietly falling back to a random port. `nanocoder init` now rejects any option it does not honour, including global flags such as `--provider` that it previously accepted and dropped, and `nanocoder review` validates against the same flag list its parser uses, so unsupported flags are reported as unknown instead of as a misleading extra review target. Negative numbers are read as values only for the numeric flags, so `--context-max -5` reports an invalid context length while `--provider -5` remains an unknown option. Closes #1939.
