---
"@nanocollective/nanocoder": minor
---

File search (path matching and content search) is now backed by `ripgrep` instead of a hand-rolled JS walker.

Search also respects `.nanocoderignore` and binary files again, matching `list_directory` and file autocomplete.

A failed search now reports the failure instead of returning an empty result set.

`.nanocoderignore` directories are skipped during the walk rather than filtered afterwards, so a large ignored directory can no longer crowd real files out of the results.
