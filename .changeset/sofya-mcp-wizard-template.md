---
"@nanocollective/nanocoder": minor
---

The MCP setup wizard (`/settings mcp`) now offers a **Sofya** template on the remote servers tab, alongside You.com, Serply and FXMacroData. It builds a remote HTTP MCP config pointing at `https://sofya.co/mcp`, giving the agent web search, page fetch as markdown, content extraction and cited multi-source research. The API key is required and is sent as a bearer `Authorization` header. Keys containing spaces, line breaks or control characters are rejected in the form.
