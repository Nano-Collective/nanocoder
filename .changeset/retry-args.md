---
"@nanocollective/nanocoder": patch
---

`/retry` no longer re-sends the prompt on the current model when it cannot use an argument. `--model=<id>` and `--provider=<name>` now work; an unknown argument, a flag with no value, or `--provider` without `--model` shows the usage and re-sends nothing.
