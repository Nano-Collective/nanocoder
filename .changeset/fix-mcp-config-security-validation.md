---
"@nanocollective/nanocoder": patch
---

Fix `loadAppConfig` stripping the `.source` field when unwrapping MCP server configs, which silently disabled `validateProjectConfigSecurity`'s hardcoded-credential scanner for project-level MCP servers. Closes #1248.
