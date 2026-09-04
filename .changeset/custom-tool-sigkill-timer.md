---
"@nanocollective/nanocoder": patch
---

Fixed a custom tool that ignores `SIGTERM` hanging past its own timeout. On timeout the handler sent `SIGTERM` and scheduled a `SIGKILL` escalation a second later, but the escalation was guarded on `!child.killed` — a flag Node sets the moment a signal is delivered, so the `SIGTERM` on the line above had already made it true and the force-kill never ran. A script that traps `SIGTERM` therefore survived, `close` never fired, and because the rejection lives in the `close` handler the tool call never settled at all. Nothing held a reference to that inner timer either, so on a clean exit it was never cleared and fired later against a dead process. Both timers are now tracked and cleared together, and the dead guard is gone. Thanks to @yashksaini-coder. Closes #1141.
