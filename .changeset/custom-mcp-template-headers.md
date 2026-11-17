---
"@nanocollective/nanocoder": patch
---

The Custom MCP Server template in `/settings mcp` now has an HTTP headers field (`Name: value`, one per line), and editing a server through it keeps what it already had: its transport, its headers, and its environment variables. Before, editing an HTTP server whose template was removed (Serply, FXMacroData) or any custom server rebuilt it as `stdio` by default and saved it without its API-key header or env vars.
