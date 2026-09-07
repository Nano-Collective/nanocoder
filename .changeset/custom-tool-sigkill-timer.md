---
"@nanocollective/nanocoder": patch
---

Fixed custom tools hanging past their own timeout. Three things went wrong on the timeout path. The `SIGKILL` escalation was guarded on `!child.killed` — a flag Node sets the moment a signal is delivered, so the `SIGTERM` on the line above had already made it true and the force-kill never ran. Nothing held a reference to the escalation timer either, so on a clean exit it was never cleared and fired later against a dead process. And the rejection lived in the `close` handler, which waits for the stdio pipes to drain as well as for the process to exit; since `SIGKILL` only reaches the shell, any grandchild that inherited stdout — a background job, a dev server, a wrapper script — held those pipes open and kept the call pending long after the shell was gone. Both timers are now tracked and cleared together, the dead guard is gone, and the timeout settles on `exit` with the stdio streams destroyed. Thanks to @yashksaini-coder. Closes #1141.
