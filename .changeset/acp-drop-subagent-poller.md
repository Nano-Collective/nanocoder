---
"@nanocollective/nanocoder": patch
---

Fix an ACP `agent` tool card showing another chat's subagent progress. The card title now comes from the session's own subagent run events, not from a process-wide timer that polled every subagent in the process every 1.5 seconds and could show the busiest one.
