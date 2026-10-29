---
"@nanocollective/nanocoder": minor
---

Nanocoder's ACP agent now honours the `mcpServers` an editor sends on `session/new`, `session/load` and `session/resume`. Stdio and HTTP servers are connected for that session only, so their tools exist in that session (and in subagents it starts) and in no other, and your own MCP configuration is never read or changed. Loading or resuming a session replaces its previous servers, and closing it, or deleting it, disconnects them. A server that fails to connect, or uses SSE, is logged and skipped and the request still succeeds. `initialize` now reports `mcpCapabilities` (`http`). A tool whose name an existing tool already has is skipped, and these tools follow the usual approval rules. Sessions with no servers behave as before.
