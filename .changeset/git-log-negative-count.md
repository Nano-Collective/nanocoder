---
"@nanocollective/nanocoder": patch
---

`git_log` no longer returns the whole history for a negative `count`. Before, `-1` went through to `git log -n -1`, which git treats as no limit. Now `count` becomes a whole number between 1 and 50, and anything that is not a positive number uses the default of 10. The input schema also declares `minimum: 1`.
