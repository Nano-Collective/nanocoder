---
"@nanocollective/nanocoder": minor
---

Sunset `/setup-providers` and `/setup-mcp` in favour of `/settings`. Both retired names still work for now — they open the matching `/settings` tab with a notice instead of erroring. `/settings` now takes a tab argument (`/settings providers`, `/settings mcp`), MCP has its own settings tab, and provider edits made from settings apply to the running session instead of waiting for the next launch.
