---
"@nanocollective/nanocoder": patch
---

Fix `config show` to report the source of the first valid default mode and list the overridden values. The `agents.config.json` schema and MCP configuration guide now recognize servers defined in named profiles, and `config show` explains where profiles fit in the merge order. Profile servers require a non-empty command for stdio (the default) or a non-empty URL for HTTP and WebSocket.
