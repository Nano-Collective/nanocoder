---
"@nanocollective/nanocoder": patch
---

Fixed `git_add` treating the `files` entries as options instead of paths. The list was appended straight after `add`, so a file named `-weird.txt` was rejected as an unknown switch, and an entry such as `--force` was read by git as an option - staging an ignored `.env` without a prompt in auto-accept mode. `git_add` now closes the option list with `--`, matching `git_diff` and `git_log`. Closes #1933.
