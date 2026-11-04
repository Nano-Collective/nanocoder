---
"@nanocollective/nanocoder": patch
---

ACP no longer falls back to `auto-accept` when a mode is wrong. `session/set_mode` now rejects an unknown mode ID with an invalid-params error and leaves the mode unchanged, where a typo or a renamed mode used to turn approvals off silently. `nanocoder --acp --mode <mode>` now starts every new, loaded and resumed session in that mode instead of ignoring the flag. A `session/set_mode` that succeeds is confirmed with a `current_mode_update` notification, so a client can check the mode that was applied. Closes #1900.
