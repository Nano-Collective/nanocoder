---
"@nanocollective/nanocoder": patch
---

Built-in slash commands no longer treat an attached VS Code editor selection as arguments. With the extension connected, `/resume`, `/retry --model`, `/checkpoint load`, `/compact` and the other built-ins read the selection that follows the prompt as extra words. So `/resume` with a selection tried to resume a session named after it instead of opening the picker. Custom commands and MCP prompts still receive the full message.
