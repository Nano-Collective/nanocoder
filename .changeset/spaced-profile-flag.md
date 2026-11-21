---
"@nanocollective/nanocoder": patch
---

Fix `nanocoder config show --profile <name>` (spaced form) treating the profile name as a config key. Both `--profile <name>` and `--profile=<name>` now resolve the same profile for `config show`, `diff` and `list`, and a bare `--profile` without a value reports an error instead of silently clearing the selection. Closes #2304.
