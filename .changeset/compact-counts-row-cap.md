---
'@nanocollective/nanocoder': patch
---

The live compact tool-activity summary above the input now shows at most 5 tool rows, followed by a `+N more` line. A turn that uses many distinct tools (for example with several MCP servers enabled) could previously add one footer row per tool and push the input box out of view on a short terminal. Closes #1291.
