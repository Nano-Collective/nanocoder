---
"@nanocollective/nanocoder": patch
---

Codex and Copilot login credentials are now saved atomically through an owner-only (0600) temp file. Before, the store was rewritten in place and then chmod-ed, so an existing file with wider permissions briefly held the new tokens readable by other users, and a crash mid-write could truncate it.
