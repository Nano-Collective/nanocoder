---
"@nanocollective/nanocoder": patch
---

A shell command that exits non-zero is now reported as failed in `--plain --json` output and over ACP. `execute_bash` returned its output as plain text, so the exit status never reached the tool result: the JSON report filed a failing build's output under `result` rather than `error`, and ACP clients such as Zed showed it as completed. The handler now reports the failure alongside its text, which the model still receives unchanged. Closes #1391.
