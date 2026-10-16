---
"@nanocollective/nanocoder": patch
---

Fixed Backspace doing nothing in the MCP setup wizard's custom-server environment variables field. It now removes the last character, including a line break, like every other text field. Closes #1406.
