---
"@nanocollective/nanocoder": patch
---

Read `agents.config.json`, `nanocoder-preferences.json`, `.mcp.json` and markdown frontmatter that start with a UTF-8 BOM instead of silently falling back to defaults, and stop a settings update being dropped when the file has a BOM. Thanks to @Seyamalam. Closes #1931.
