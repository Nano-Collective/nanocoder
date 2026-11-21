---
"@nanocollective/nanocoder": patch
---

Fix `nanocoder run` aborting when the prompt merely mentions an option name (e.g. `run "explain the --vscode-port option"`). A flag with an unusable value inside the prompt is now ignored with a warning instead of exiting, `--continue`/`--resume`/`--acp` only count before `run`, and `init`'s unknown-option error points at `nanocoder init --help`. Closes #2308.
