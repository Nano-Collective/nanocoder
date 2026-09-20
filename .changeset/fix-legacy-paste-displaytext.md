---
"@nanocollective/nanocoder": patch
---

Fixed a paste restored from an older session's prompt history being sent to the model as its own label. Placeholder lookup now matches on each entry's display text, but entries persisted before placeholders carried a `displayText` have none, so they were skipped and their `[Paste #N: X chars]` label survived into the prompt instead of expanding to the pasted content. Those entries now have their label rebuilt from the ordinal in their key and the content they hold, matching the legacy fallback that the display-text lookup replaced.
