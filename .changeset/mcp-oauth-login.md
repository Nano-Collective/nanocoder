---
"@nanocollective/nanocoder": patch
---

Add OAuth support for remote HTTP MCP servers. Servers that answer with an OAuth challenge are now shown under "Authentication required" in `/mcp`, and `/mcp login <server>` runs the standard authorization-code + PKCE flow (discovery, dynamic client registration, browser sign-in, loopback redirect). Tokens are stored owner-only in the Nanocoder config directory, refreshed automatically, and removed with `/mcp logout <server>`. Closes #2014.
