---
"@nanocollective/nanocoder": minor
---

This extends the `showOutput` mechanism introduced in [#714](https://github.com/Nano-Collective/nanocoder/pull/714) (commit `59dc92f5`), which made user-typed `!commands` render their captured output on the completed `execute_bash` card while agent-invoked `execute_bash` calls always collapsed to a compact card (command + status dot + token count) — discarding the output that had streamed live while the command ran.
  