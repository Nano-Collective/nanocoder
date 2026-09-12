---
'@nanocollective/nanocoder': patch
---

Add terminal support for `/copy code`.

Running `/copy code` in the terminal previously returned "This functionality isn't supported in the terminal." It now parses fenced code blocks from the last assistant message and copies the most recent block to the system clipboard, matching the VS Code webview behaviour. Returns "No code blocks found in the last response." when the last response contains no fenced blocks.
