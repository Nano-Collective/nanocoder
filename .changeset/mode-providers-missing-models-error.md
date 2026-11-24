---
"@nanocollective/nanocoder": patch
---

Emit a clear error message instead of throwing an unhandled TypeError when a `modeProviders` entry references a provider that lacks a `models` list in `agents.config.json`. Closes #2251.
