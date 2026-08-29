---
'@nanocollective/nanocoder': patch
---

Custom tools on Windows now spawn `cmd.exe /c` (same as `execute_bash`) instead of `-c`, which cmd does not accept. Closes #1028.
