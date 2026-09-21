---
"@nanocollective/nanocoder": patch
---

Fixed a lifecycle hook surviving its own timeout. `killHookTree` sent one `SIGTERM` to the hook's process group and returned; the `SIGKILL` beside it ran only in the `catch`, which is the branch taken when the group is *already* gone rather than when it refuses to die. A hook that traps `SIGTERM`, or that is blocked in an uninterruptible call, therefore kept running after the agent moved on - the exact runaway the detached spawn exists to prevent. The timeout now destroys its end of the pipes, signals the group, and arms a deliberately uncancelled `SIGKILL` escalation a second later, mirroring what `custom-tools/handler.ts` does since #1141: a shell exiting does not mean its group is empty, so the escalation has to outlive it. Windows is unchanged, where the reap is `taskkill /T /F` and already unconditional.
