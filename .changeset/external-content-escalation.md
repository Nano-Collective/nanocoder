---
"@nanocollective/nanocoder": minor
---

While text from outside your project is in the model's view, calls that can change files or reach the network now ask for confirmation in auto-accept and architect, and the prompt names what was read. This is opt-in: set `nanocoder.untrustedContent.escalate` to `true` in `agents.config.json`. Escalation covers file writes, `fetch_url` / `web_search` / `browser`, MCP tools and `agent` delegation; asking the user a question, the task list and the plan tools are not escalated, because they do not change the workspace. A subagent inherits the mark from its parent and marks its own answer when it read outside text, so delegation closes both directions. An escalated write approved in architect is still added to the turn's checkpoint. `yolo`, normal mode and headless runs are unchanged. The mark is pinned for the run, so auto-compaction cannot hand a later write the mode's waiver back mid-turn.
