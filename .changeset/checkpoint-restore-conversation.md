---
"@nanocollective/nanocoder": patch
---

Fix `/checkpoint load` so it restores both workspace files and conversation history; previously only files were reverted, leaving the model context desynchronised. (Fixes #1242.)
