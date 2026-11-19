---
"@nanocollective/nanocoder": patch
---

Auto-compaction in the interactive TUI now measures the same capped history that is sent to the model (`sessions.maxMessages`), as `nanocoder run`, `--plain` and subagents already did. Before, a long session could auto-compact because of old messages the cap had already dropped from every request, even though what the model received was well under the threshold.
