---
"@nanocollective/nanocoder": minor
---

Added `?key=value` inline overrides to slash commands (e.g. `/usage ?context-max=200k`). An override is applied via the existing session-override plumbing and restored to its prior value when the command finishes, so users can test a setting for a single command without changing the session state. Closes #1151.

**Working example:**
- `/usage ?context-max=200k` - renders context usage against a 200k limit for this command only, then restores the prior limit. This works because `/usage` reads `getSessionContextLimit()` synchronously inside its handler.

**Also supported:**
- Boolean flag forwarding (`?preview`, `?preview=on` → `--preview`) for commands that already accept those flags, e.g. `/compact ?preview`.
- `threshold` and `auto-compact` keys are parsed and round-tripped through the session-override stores (apply then restore the prior value), but no built-in slash command currently reads them synchronously during dispatch — the automatic compaction path only runs on chat turns. They are reserved plumbing, not advertised as working command examples.

**Behavior:**
- Unknown `?foo=bar` keys are silently ignored (no error message).
- Values containing additional `=` are preserved (`?config=key=value` → `'key=value'`).
- Override applies only to the current command; it does not affect global session state.
- Custom commands and MCP prompts bypass override parsing (they receive `?foo=1` literally).
