---
"@nanocollective/nanocoder": patch
---

Fix a glob in a skill subscription's `paths` or `branches`, a formatter's `match`, or a lifecycle hook's file filter being able to stall the daemon or agent loop. These globs were compiled to a backtracking regex, so a pattern with several `*` could take minutes to match one long path. They now use the same matcher as file search, which runs in linear time. Spaces around `{a, b}` alternatives are now ignored, and a pattern over 1,000 characters or with more than 64 brace combinations now matches nothing.
