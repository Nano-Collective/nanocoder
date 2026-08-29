---
"@nanocollective/nanocoder": patch
---

Fixed `disconnectMCP()` wiping every workspace custom tool. An MCP server disconnecting, restarting, or crashing rebuilt the tool registry from the built-ins and cleared the custom tool map, so custom tools disappeared until Nanocoder was restarted. The MCP tools are now unregistered by name only, which also keeps the per-tool `approval` and `readOnly` metadata that plan and headless mode read. Closes #1034.
