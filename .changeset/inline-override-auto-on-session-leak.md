---
"@nanocollective/nanocoder": patch
---

The `?auto-on` and `?auto-off` inline overrides no longer change auto-compact for the rest of the session. They expanded to `--auto-on` and `--auto-off`, which persist, contradicting the rule that an inline override only lasts for the one command it is typed on. Use `?auto-compact=on` or `?auto-compact=off` for a one-command change, or `/compact --auto-on` and `/compact --auto-off` to change the session.
