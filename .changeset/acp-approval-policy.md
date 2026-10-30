---
"@nanocollective/nanocoder": patch
---

ACP clients can now see which tools skip the permission prompt. The `session/new`, `session/load` and `session/resume` responses list, under `_meta["nanocoder/approval"].alwaysAllow`, the tools offered in the session that an `alwaysAllow` list (the top-level one or an MCP server's) lets run without asking, so a client can tell that `normal` mode will not ask for them. How approvals are decided is unchanged. Closes #1910.
