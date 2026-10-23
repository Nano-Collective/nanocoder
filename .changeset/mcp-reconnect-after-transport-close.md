---
"@nanocollective/nanocoder": patch
---

MCP servers now reconnect after their connection drops. Previously, once a stdio server crashed or a socket closed, the server stayed unhealthy for the rest of the session because every later health check failed with "Not connected". Nanocoder now reconnects from the server's config with exponential backoff and restores its tools when the connection comes back. Reconnect attempts stop when MCP is shut down.
