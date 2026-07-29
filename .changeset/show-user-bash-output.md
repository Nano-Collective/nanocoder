---
"@nanocollective/nanocoder": patch
---

Fixed user-typed `!` bash commands showing no output in the transcript. Previously the completed card only displayed the command, a status dot, and a token count — the actual result was sent to the model but never shown to the person who typed the command. Completed `!` commands now render their stdout and stderr (tail-capped at 20 lines, with a note when earlier lines are hidden). Model-invoked `execute_bash` calls keep their compact display.
