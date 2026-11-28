---
"@nanocollective/nanocoder": patch
---

Fix `/memory propose` offering recalled memories and matched skills as new proposals: the injected `<turn-context>` block is now stripped before messages are scanned, and proposals already matching a saved memory are skipped. Saving matching content now refreshes the existing entry (timestamp, git snapshot and explicit category, keeping its id) instead of adding a copy, so accepting a proposal cannot store a second copy. `/memory add` and `/memory accept` now say when a memory was already saved. Closes #2355.
