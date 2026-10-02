---
"@nanocollective/nanocoder": minor
---

Add user-defined slash command aliases via `nanocoder.aliases` in `agents.config.json`. Map any short code to a built-in or custom command (e.g. `{"c": "compact", "e": "export"}`) so `/c` runs `/compact`, `/e session.md` runs `/export session.md`, and the picker offers the alias as autocomplete. Built-in names win on conflict; aliases that target an unknown command yield the standard "Unknown command" error. Closes #930.