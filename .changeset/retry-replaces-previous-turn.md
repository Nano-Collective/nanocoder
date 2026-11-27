---
"@nanocollective/nanocoder": patch
---

- Make `/retry` replace its previous attempt in conversation history and skip shell output and internal notices when choosing the prompt. After plan approval, retry the implementation and remind the model to reread files before editing because previous changes remain on disk. Closes #2352.
