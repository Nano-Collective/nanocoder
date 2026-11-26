---
"@nanocollective/nanocoder": minor
---

feat(mcp): on-demand MCP tool discovery to preserve local context windows (#1571)

Implements a deferred MCP tool discovery mechanism that extracts lightweight tool catalog summaries and provides a built-in `load_tool_schema` tool to hydrate full tool schemas on-demand.
