---
"@nanocollective/nanocoder": patch
---

Slash commands that take free text no longer have their `?word` tokens rewritten. Inline `?key=value` overrides were parsed for every command, so `/remember ?important use tabs` was stored as "use tabs ?important" and `/tasks add check ?preview` became `--preview`. Overrides are now only parsed for `/compact` and `/usage`, the commands that read them, and every other command receives its arguments exactly as typed.
