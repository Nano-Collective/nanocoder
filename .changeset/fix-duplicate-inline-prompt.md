---
'@nanocollective/nanocoder': patch
---

Fix user prompts appearing twice in the terminal scrollback when the model starts streaming a response in default inline mode. Pressing Escape to recall an in-flight prompt in inline mode now leaves the bubble visible in scrollback rather than removing it from the live view, since it has already been committed to Ink's transcript and cannot be un-printed.
