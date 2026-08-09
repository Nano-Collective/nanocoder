---
"@nanocollective/nanocoder": patch
---

Fixed `Cannot read properties of undefined (reading 'summaryParts')` when streaming from GitHub Copilot with reasoning models such as `gpt-5.3-codex`. Copilot's Responses API proxy emits reasoning summary events under item ids it never announced, which crashed the OpenAI Responses stream parser; the Copilot response stream now announces those reasoning items before the summary events reach the parser. Closes #719.
