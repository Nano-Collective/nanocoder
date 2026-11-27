---
"@nanocollective/nanocoder": patch
---

Fixed `git_status` and `git_add` losing line counts for file names with spaces or non-ASCII characters. Git tooling now parses NUL-delimited (`-z`) output from `git status --porcelain` and `git diff --numstat`, which is never quoted or escaped, so paths and their addition/deletion counts are reported correctly. Renames are also handled properly.
