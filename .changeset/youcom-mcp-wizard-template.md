---
"@nanocollective/nanocoder": minor
---

The MCP setup wizard (`/settings mcp`) now offers a **You.com** template alongside Brave Search and DuckDuckGo. It builds a remote HTTP MCP config pointing at `https://api.you.com/mcp`, giving the agent web search, URL reading, and research tools. The API key prompt is optional: pasting a `YDC_API_KEY` builds an authenticated config with a bearer header, while leaving it empty falls back to the keyless free profile (`https://api.you.com/mcp?profile=free`) so search works with zero signup.
