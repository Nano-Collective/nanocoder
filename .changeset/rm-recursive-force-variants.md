---
'@nanocollective/nanocoder': patch
---

Block every common spelling of a recursive force delete of `/` in the `execute_bash` safety check. Only the exact text `rm -rf /` was refused before, so `rm -fr /`, `rm -r -f /`, `rm -Rf /`, `rm --recursive --force /` and `rm -rf --no-preserve-root /` reached the shell, as did `rm -rf ~`, `rm -rf $HOME` and `rm -rf /*`. The flags are now parsed in any order and grouping, and the target is resolved too, so `/*/*`, `/*/`, `/.`, `/..` and line-continuation forms are caught while ordinary cleanups such as `rm -rf node_modules` or `rm -rf ~/project/dist` are still allowed. Closes #1938.
