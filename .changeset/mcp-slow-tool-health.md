---
"@nanocollective/nanocoder": patch
---

A slow MCP tool call no longer gets its server marked unhealthy and its tools removed mid-turn. Health checks now skip the ping while a tool call or resource read is in flight on that server, and a server is only marked unhealthy after two missed pings in a row. A closed transport is still reported straight away.
