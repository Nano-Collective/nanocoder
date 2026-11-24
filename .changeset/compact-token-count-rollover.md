---
"@nanocollective/nanocoder": patch
---

Fix token counts just under a unit boundary rendering as `1000k` (or `1000`) in the usage indicator, stats view and token charts; they now roll over to `1M` / `1k`.
