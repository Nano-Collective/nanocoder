---
"@nanocollective/nanocoder": minor
---

Added MCP resources and prompts support, closing the gap between the MCP client and `docs/battlemap.md`'s claim of parity with Claude Code. `MCPClient` now discovers a connected server's resources and prompts alongside its tools (best-effort — a server that doesn't declare either capability just contributes none, same as before). Resources are usable the same way local files already are: type `@` to fuzzy-search filenames and connected servers' resources together, and select one to inline its content. Prompts are usable the same way custom commands already are: type `/mcp:<server>:<prompt>` to fetch the prompt fresh from its server and send it as the next turn, with positional arguments filled in against the prompt's declared parameter order. Refs #1162.
