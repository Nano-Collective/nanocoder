---
"@nanocollective/nanocoder": patch
---

Setting `healthCheckInterval: 0` on an MCP server now fully disables liveness pings. A transport error used to trigger a ping anyway, which could mark the server unhealthy with no periodic check left to recover it.
