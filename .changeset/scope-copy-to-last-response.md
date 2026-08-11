---
"@nanocollective/nanocoder": patch
---

VS Code extension: `/copy` and `/copy code` now address the whole last assistant response rather than its final text fragment, so a tool call between the code block and the closing prose no longer hides the block. Also collapses inner whitespace in the `/copy  code` intercept, reports "No response to copy yet" on an empty transcript, and replies with a pointer instead of "Unrecognized slash command" if `/copy` reaches the ACP agent.
