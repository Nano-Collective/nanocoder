---
'@nanocollective/nanocoder': patch
---

On Windows, cancelling or timing out `execute_bash` or a custom tool now stops the program the command started, not just its `cmd.exe` wrapper, so a dev server no longer keeps holding its port. Closes #1657.
