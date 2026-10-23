---
"@nanocollective/nanocoder": patch
---

`nanocoder verify` now passes `--` before the changed file paths it hands to semgrep, so a pull request that adds a file whose name looks like a flag (for example `--output=...`) can no longer change how semgrep runs.
