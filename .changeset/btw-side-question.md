---
"@nanocollective/nanocoder": minor
---

Added `/btw <question>` for quick side questions that do not enter conversation history. The question runs as a separate tool-free request against the current conversation snapshot, shows the answer in a dismissible panel, can be cancelled with Escape without affecting the main turn, and still records usage for `/usage` and lifetime stats. Closes #2279.
