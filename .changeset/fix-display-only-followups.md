---
"@nanocollective/nanocoder": patch
---

Closed the remaining routes by which nanocoder's own UI text reached the model. The ACP timeline-revert notice ("Reverted to before step N…") was still pushed into history as a plain assistant message, and `/compact` (plus auto-compact) fed display-only notices into the LLM summariser, whose summary re-enters context as a real `user` message — so a compacted session could still be told it had errored. Notices are now excluded from the summarised segment, and context-usage estimates and the auto-compact threshold count only what the provider actually receives. Also documents the `displayOnly` contract on `Message`, warns when a display-only message carries `tool_calls` (which would silently drop its tool results from the payload), and shares the "Tool approval required for: " prefix as a constant so the non-interactive exit-code path can't break on a reword.
