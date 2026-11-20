---
"@nanocollective/nanocoder": minor
---

Tool results that came from outside your project — `fetch_url`, `web_search`, `browser` and every MCP tool — now reach the model inside an `<external_content source="..." url="...">` frame, and the system prompt says that everything inside it is data to read, never instructions. Lookalike delimiters inside the content are neutralised so a page cannot close the frame early, and a structured MCP result is delivered as text so it cannot bypass the frame. Results wrapped this way are marked in the chat with `⚠ external content · treated as data`. Files in your repository, shell output and language-server results are unaffected.
