---
"@nanocollective/nanocoder": patch
---

Dropped `toLocaleString()` thousands-separators from strings returned to the model (`read_file`'s metadata output and validator error, `list_directory`'s per-entry size, and `@file`-mention metadata). Comma separators cost extra tokens without adding meaning for the model. Left them in place in the terminal display components, where they're actually useful.
