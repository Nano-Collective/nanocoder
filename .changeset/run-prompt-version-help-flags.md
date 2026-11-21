---
"@nanocollective/nanocoder": patch
---

Fix `nanocoder run` printing the version or the help and exiting 0 without running when the prompt contains `-v`, `--version`, `-h` or `--help` (e.g. `nanocoder run go test -v`). These flags now only count before `run`; after it they are prompt text. Closes #2315.
