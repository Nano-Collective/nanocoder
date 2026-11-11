---
"@nanocollective/nanocoder": minor
---

Removed the Serply and FXMacroData templates from the MCP setup wizard (`/settings mcp`). Servers you already added keep working, since they are plain HTTP entries in `.mcp.json`. To add either one now, write the `http` entry with its `url` and `headers` in `.mcp.json` directly (see the MCP configuration docs); the wizard's Custom MCP Server template has no headers field, so edit an existing keyed entry in the file (Ctrl+E) rather than through the wizard, which would drop the key.
