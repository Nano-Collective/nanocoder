---
"@nanocollective/nanocoder": patch
---

`nanocoder --plain` no longer fails when the last-used provider has since been renamed or removed from `agents.config.json`. It now falls back to the first configured provider with a notice, as the interactive TUI already did. An explicit `--provider` that does not exist is still an error.
