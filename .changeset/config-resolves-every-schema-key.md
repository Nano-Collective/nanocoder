---
"@nanocollective/nanocoder": patch
---

`config list`, `config show` and `config diff` now know about `autoCommit`, `formatters`, `hooks`, `lspServers`, `sandbox` and `notifications`.

`blockSpecs()` is a hand-written list of the keys the command resolves, and it had fallen behind the loader: `config show nanocoder.autoCommit` exited 1 with "No configuration key matching", and those keys were absent from `config list` and `config diff`. The ones that went missing are the settings that run shell commands or create commits, which is what a person wants to check before running a cloned repository.

A test now reads `schemas/agents.config.schema.json` and fails when a key the loader reads cannot be shown, so the two lists cannot drift apart again.
