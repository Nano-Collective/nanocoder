---
"@nanocollective/nanocoder": patch
---

Fixed `Cannot read properties of undefined (reading 'summaryParts')` when streaming from GitHub Copilot with reasoning models such as `gpt-5.3-codex`. Copilot's Responses API proxy rotates the opaque reasoning item id mid-stream while `output_index` stays stable, so the OpenAI Responses parser looked up state that was never registered and the stream died. Copilot's response stream is now normalized before it reaches the parser: a rotated id is mapped back to the reasoning item already tracked at that `output_index`, and a reasoning item that was never announced is announced first. Closes #719.
