---
"@nanocollective/nanocoder": patch
---

Prompt scrubbing now applies everywhere once it is switched on, not only to the main TUI conversation. The setting was only passed to the model client by the interactive chat, so `nanocoder --plain`, ACP sessions (including the VS Code extension), subagents and helper calls such as compaction sent secrets from files, command output and tool results to the provider unscrubbed.
