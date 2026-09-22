---
"@nanocollective/nanocoder": patch
---

Fixed `/update` reporting a failure when the package manager exited 0. `hasCommandFailed` fell through from the exit-code check into the generic pattern match, so a benign success summary like "0 failed" or "0 cannot be updated" was reported as an error. When the command exits 0, only unambiguous error indicators (command not found, no such file or directory, permission denied, `error:` lines, `fatal`) still count as a failure. Closes #1304.
