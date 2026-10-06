---
"@nanocollective/nanocoder": patch
---

Fix the compact tool-activity summary showing identical "Ran N git command(s)" rows for `git_status`, `git_diff` and `git_log`, making a turn that mixes them indistinguishable. Each git tool now gets its own phrasing. Closes #1556.
