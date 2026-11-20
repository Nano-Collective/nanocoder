---
"@nanocollective/nanocoder": minor
---

While text from outside your project is in the model's view, calls that can change files or reach the network now ask for confirmation in auto-accept and architect, and the prompt names what was read. This is opt-in: set `nanocoder.untrustedContent.escalate` to `true` in `agents.config.json`. Escalation covers file writes, commands, `fetch_url`/`web_search`/`browser`, MCP tools and subagent delegation; a subagent started from tainted context stays tainted; an escalated write approved in architect is still added to the turn's checkpoint. `yolo`, normal mode and headless runs are unchanged. The mark is derived from the framed results the model can actually see, so it needs no extra state and cannot drift from the conversation.
