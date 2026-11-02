---
'@nanocollective/nanocoder': minor
---

Added MCP server liveness checks that detect failed pings and transport closures, remove unavailable tools, and show unhealthy servers in `/mcp`.

Pings are skipped while a tool call or resource read is in flight, a server is marked unhealthy only after two missed pings in a row (a closed transport is reported at once), and `healthCheckInterval: 0` disables pings entirely.
