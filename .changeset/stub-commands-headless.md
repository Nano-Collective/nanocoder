---
"@nanocollective/nanocoder": patch
---

Slash commands whose logic lives in the TUI (`/compact`, `/context-max`, `/model`, `/retry`, `/settings`, `/status`, `/tune`) no longer silently do nothing outside the interactive app. Their stub handlers now report that the command requires interactive mode, and `--plain run` rejects any built-in slash command with that error (exit code 1) instead of sending it to the model. Closes #1517.
