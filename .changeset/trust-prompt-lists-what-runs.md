---
'@nanocollective/nanocoder': minor
---

The directory trust prompt now lists the plugins, hooks, formatters, and MCP servers in the folder. Trust stores a fingerprint of those files, and the prompt comes back when they change. A folder trusted before this change is asked again once. Closes #1659.
