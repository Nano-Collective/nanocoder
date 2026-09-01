---
"@nanocollective/nanocoder": patch
---

Fixed paste placeholders silently overwriting each other. Placeholder ids were derived from the number of live entries, so deleting one freed its id for reuse and the next paste clobbered a placeholder that was still in the input - destroying its content and leaving a duplicate label that got sent to the model as literal text. Ids are now namespaced by type (`paste_1`, `file_1`) and allocated from the highest id ever used, so a deletion can never free an id. Placeholder lookup now matches on each entry's own display text instead of a paste-shaped regex, which also makes `@file` mentions delete atomically rather than leaving an orphan entry behind, and lets two placeholders that render identically expand to their own content.
