---
'@nanocollective/nanocoder': patch
---

Isolate `benchmarks/agent` runs from the user's real config. Each run now gets a temporary config containing only the provider entries it needs, so benchmarking no longer changes saved preferences or runs global hooks. Thanks to @ducanhnguyen223. Closes #1744.
