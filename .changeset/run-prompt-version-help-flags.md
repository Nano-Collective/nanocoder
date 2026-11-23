---
"@nanocollective/nanocoder": patch
---

Fix `nanocoder run` printing the version or the help and exiting 0 without running when the prompt contains `-v`, `--version`, `-h` or `--help` (e.g. `nanocoder run go test -v`). These flags now only count before `run`; after it they are prompt text. The one exception is `nanocoder run --help` (or `-h`) with nothing else after `run`, which still prints the help instead of starting a run. Closes #2315.
