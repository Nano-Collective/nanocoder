---
"@nanocollective/nanocoder": patch
---

Reject extra arguments to `/context-max` instead of silently dropping them. Inputs such as `/context-max 128 k` or `/context-max 1 m` used to set a limit that was off by a factor of 1,000 or 1,000,000, and `/context-max 200k extra` reported success while ignoring the rest of the line. Any invocation with more than one argument now reports `Too many arguments. Usage: /context-max <limit> | --reset` and leaves the session limit untouched, including `--reset` with trailing arguments. Closes #2428.
