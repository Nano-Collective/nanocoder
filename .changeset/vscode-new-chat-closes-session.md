---
"@nanocollective/nanocoder": patch
---

The VS Code extension's New Chat now sends `session/close` for the conversation it leaves, when the agent supports it. Previously the old session stayed open in the agent, holding its timeline lock and history in memory until the agent process exited. A failed close is logged to the Nanocoder output channel and does not block the new chat.
