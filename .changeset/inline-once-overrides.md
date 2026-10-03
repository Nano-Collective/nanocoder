---
"@nanocollective/nanocoder": minor
---

Added `?key=value` inline overrides to slash commands. An override is applied via the existing session-override plumbing and restored to its prior value when the command finishes, so users can test a setting for a single command without changing the session state. Closes #1151.

**Working examples:**
- `/usage ?context-max=200k` - renders context usage against a 200k limit for this command only, then restores the prior limit.
- `/compact ?threshold=80` - gates the manual compaction on current usage: compacts normally at or above 80%, otherwise reports the usage and skips (mirroring the automatic path's gate). Composes with `?context-max`, which the gate reads as the limit.
- `/compact ?preview`, `/compact ?auto-on` - boolean flags forwarded as their `--flag` long forms.

**Behavior:**
- `threshold` values outside 50–95 and unparseable values are ignored (fail open: the command runs un-gated).
- `auto-compact` is parsed and round-tripped through the session-override stores (apply then restore), but no built-in slash command currently reads it synchronously during dispatch — reserved plumbing for the automatic compaction path.
- Unknown `?foo=bar` keys are never consumed: the dispatcher forwards them to the command handler verbatim (so each command's own unknown-arg handling runs) and queues one warning naming the key, so a typo cannot silently no-op.
- Values containing additional `=` are preserved (`?config=key=value` → `'key=value'`).
- Override applies only to the current command; it does not affect global session state.
- Custom commands and MCP prompts bypass override parsing (they receive `?foo=1` literally).
