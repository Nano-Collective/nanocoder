---
"@nanocollective/nanocoder": minor
---

The MCP setup wizard (`/settings mcp`) now offers a **Serply** template alongside Brave Search, DuckDuckGo and You.com. It builds a remote HTTP MCP config pointing at `https://api.serply.io/mcp`, giving the agent Google, Bing, News, Scholar, Maps, Jobs and Amazon search plus URL scraping. The API key is required and is sent as an `X-API-Key` header.

Editing a wizard-built server whose key is stored in an `X-API-Key` header now re-opens the form with that key prefilled. Previously the edit flow only recovered keys from env vars or a bearer `Authorization` header, so the required key field came back empty.
