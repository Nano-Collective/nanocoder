---
"@nanocollective/nanocoder": patch
---

`execute_bash` on Windows no longer mangles double-quoted arguments. The command was handed to `cmd /c` as an ordinary argv entry, so Node re-quoted it and escaped every inner `"` as `\"`, which `cmd.exe` does not understand. `echo "hello world"` printed the backslashes, `git commit -m "fix the bug"` failed with `pathspec 'the' did not match`, and `node -e "console.log(1+1)"` exited 0 with no output, so the agent believed it had worked. It now spawns `cmd.exe` the way custom tools already do (`/d /v:off /s /c "<command>"` with verbatim arguments), and a Windows-only spec covers `echo`, `node -e`, `git commit -m` and `git log --format`, which now runs in the Windows CI job. Fixes #1663.
