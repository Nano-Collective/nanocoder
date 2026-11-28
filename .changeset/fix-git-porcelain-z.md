---
"@nanocollective/nanocoder": patch
---

Use NUL-delimited `-z` output in `git_status`, `git_add`, `git_commit`, and `getDiffStats` so filenames with spaces, non-ASCII characters, or renames are parsed accurately. Closes #2448.
