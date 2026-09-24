---
"@nanocollective/nanocoder": patch
---

Runs triggered by the skill daemon can now use their own skill's tools, custom tools and MCP tools. The daemon registered skill tools into one tool registry but ran triggered agents against a second, empty one, and it never connected MCP servers, so a subscribed agent could only use the built-in tools. MCP servers are now also disconnected when the daemon stops, so `nanocoder daemon stop` exits cleanly.
