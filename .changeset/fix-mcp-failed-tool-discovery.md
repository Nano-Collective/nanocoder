---
"@nanocollective/nanocoder": patch
---

Fixed an MCP server staying visible as connected when its initial `tools/list` call failed. `connectToServer()` now registers the client, transport, and config only after tool discovery succeeds, and closes the partially-established client on failure so its transport/child process doesn't leak.
