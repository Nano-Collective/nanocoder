---
"@nanocollective/nanocoder": patch
---

MCP stdio servers no longer receive the entire parent environment. A server with any `env` configured now gets the MCP SDK's safe default environment plus only the variables listed in its config, so parent API keys and tokens are no longer leaked to the server. Servers supplied by an ACP client with no env entries no longer inherit the parent environment either.
