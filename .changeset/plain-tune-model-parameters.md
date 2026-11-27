---
"@nanocollective/nanocoder": patch
---

Fix `--plain` / `nanocoder run` ignoring tune's model parameters (`temperature`, `maxTokens`, reasoning settings and the rest). When tune is enabled they are now sent to the model, as the TUI already did.
