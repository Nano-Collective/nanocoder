---
"@nanocollective/nanocoder": patch
---

Fixed prompt history navigation returning an invalid value after reaching the end of the history. `getNextString()` now returns `null`, matching the behavior of the other history navigation methods.
