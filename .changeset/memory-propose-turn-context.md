---
"@nanocollective/nanocoder": patch
---

Fix `/memory propose` offering recalled memories and matched skills as new proposals: the injected `<turn-context>` block is now stripped before messages are scanned. Saving a memory whose content matches an existing one now returns the existing memory instead of adding a copy, so accepting a proposal cannot make it recur twice. Closes #2355.
