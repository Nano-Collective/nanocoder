---
"@nanocollective/nanocoder": patch
---

Interrupting a streaming reply with Esc no longer throws away what the model had already written: the partial text stays on screen and in the history, so the next request has the assistant turn to refer back to.
