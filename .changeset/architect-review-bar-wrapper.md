---
"@nanocollective/nanocoder": patch
---

Fix the architect review bar's accent border sitting out of line with the composer and every other footer modal. `ArchitectReviewPrompt` was missing the shared left-edge wrapper `PlanReviewPrompt`, `FileExplorer`, `IdeSelector` and `ModalSelectors` already use. Closes #1532.
