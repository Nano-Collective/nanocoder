---
"@nanocollective/nanocoder": patch
---

Fix `filesChanged` in the `--json` report. It now counts only tool calls that succeeded, so a failed edit no longer lists a file it never touched. It includes `file_op` (the paths a delete, move or copy changed), and it keeps relative paths such as `../x` that the tool accepted instead of dropping them. The report and ACP timeline checkpoints now read the same list of file-editing tools.
