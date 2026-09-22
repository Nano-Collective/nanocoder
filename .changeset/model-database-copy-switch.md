---
"@nanocollective/nanocoder": minor
---

`/model-database` now does something useful with Enter: it copies the highlighted model's ID to the clipboard, and, when the active provider is OpenRouter, switches the session to that model immediately (same behavior as `/model`, including its own confirmation toast). The footer hint reflects which of the two Enter will do. Closes #1310.
