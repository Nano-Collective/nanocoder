---
"@nanocollective/nanocoder": minor
---

The MCP setup wizard (`/settings mcp`) now offers an **FXMacroData** template on the remote servers tab. It builds a remote HTTP MCP config pointing at `https://mcp.fxmacrodata.com`, giving the agent macroeconomic releases, central bank rates, release calendars and FX data across 22 currencies. The API key is optional: leave it empty to use the keyless tier (the last 90 days of USD releases, each readable 15 minutes after publication, the USD release calendar, press releases and COT, plus the data catalogue, market sessions and risk sentiment for every currency), or enter a key and it is sent as a bearer `Authorization` header. Keys containing spaces, line breaks or control characters are rejected in the form.
