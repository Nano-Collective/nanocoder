---
'@nanocollective/nanocoder': minor
---

Retry unhealthy MCP servers on periodic health checks with exponential backoff and restore tools automatically when servers recover

A server whose connection closed (a crashed stdio server or dropped socket) is reconnected from its config with the same backoff, and its tools come back once it does.

A remote (HTTP or WebSocket) server that restarts and no longer knows its session is reconnected the same way, instead of being pinged with the stale session forever.
