---
"@nanocollective/nanocoder": patch
---

Fix ACP sessions and subagents treating a provider reply with no choices as a finished turn. An ACP prompt ended normally with nothing said, and a subagent handed its parent an empty answer marked as a success. Both now report "No response received from model" as an error, as the TUI and `--plain` already did.
