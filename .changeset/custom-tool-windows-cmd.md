---
'@nanocollective/nanocoder': patch
---

Custom tools on Windows now spawn `cmd.exe /d /s /c` instead of `-c`, which cmd does not accept. `/d` skips AutoRun; `/s` makes quote stripping deterministic. `{{ }}` substitution stays POSIX-quoted and is not shell-safe under cmd. Closes #1028.
