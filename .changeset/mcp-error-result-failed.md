---
"@nanocollective/nanocoder": patch
---

A tool call that an MCP server reports as failed now shows as failed. When a server answered with `isError: true`, the model got the error text but ACP editors still showed the call as `completed`, and `nanocoder run --json` filed the text under `result` instead of `error`. The failure flag now travels with the result; the text the model receives is unchanged.
