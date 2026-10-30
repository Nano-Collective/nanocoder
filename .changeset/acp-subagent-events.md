---
"@nanocollective/nanocoder": minor
---

ACP clients can now follow each subagent run on its own. Nanocoder sends a `_nanocoder/subagent` notification as every run starts, progresses and ends (`completed`, `failed` or `cancelled`), with a stable `childRunId`, the `parentRunId` (empty for a child of the turn), the parent `agent` tool call, the subagent's name, progress counts and its result or error. A new `_nanocoder/cancelSubagent` request cancels one run by `childRunId` without ending the turn: the run reports `cancelled`, the parent `agent` call gets a "Subagent was cancelled" result and carries on, and cancelling the whole turn still cancels every run. The permission request for a subagent's tool call now names its run under `_meta` as `nanocoder/childRunId`. Both are listed in `agentCapabilities._meta.nanocoder`. Clients that ignore the new notification see the same behaviour as before.
