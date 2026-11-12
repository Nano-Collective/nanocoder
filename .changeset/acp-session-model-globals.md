---
"@nanocollective/nanocoder": patch
---

Fix two ways ACP sessions leaked their model choice. Auto-commit messages in an ACP session are now written by that session's own model, not by whichever session picked a model last. A session saved with no provider or model of its own now records its client's provider and model, where before it recorded an invented `openai` / `gpt-4o` pair that a later resume tried to restore.
