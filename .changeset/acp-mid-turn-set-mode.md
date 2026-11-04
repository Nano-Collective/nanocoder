---
"@nanocollective/nanocoder": patch
---

Switching mode in an ACP editor while a prompt is running now takes effect straight away. Previously the running prompt kept the mode it started in, so moving from `yolo` or `auto-accept` back to `normal` still let the next commands and file edits run without a permission prompt. The next model request is offered the tools of the new mode, each call is approved under it, and a call the model had already returned that the new mode no longer offers (for example an edit after switching to `plan`) is refused instead of run. A call that is already running is not interrupted. Closes #1857.
