---
'@nanocollective/nanocoder': minor
---

Added per-server `toolTimeout` and `resetTimeoutOnProgress` settings for MCP tool calls. Tool calls were always cut off at the MCP SDK's 60 second default, even when the server was healthy and still working, because the existing `timeout` only covers connecting. `toolTimeout` sets how long a tool call may wait (`0` for no limit), and by default the timer now restarts whenever the server reports progress, so long builds, test runs and queries that keep reporting are no longer aborted. A timed-out call now says which limit it hit and which setting changes it. Closes #2169.
