---
"@nanocollective/nanocoder": patch
---

Auto-compaction only reports "LLM call failed" when the summary request failed. When the summary was not smaller than the original, or there was nothing to summarise, the notice now says so. Closes #2405.
