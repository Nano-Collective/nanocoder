---
'@nanocollective/nanocoder': patch
---

Fixed a renamed session losing its manual title when reopened in the CLI. The ACP agent rebuilds the session record field-by-field on every save and wasn't carrying `titleManuallySet` through, so the flag was dropped from disk after the next message. The title survived inside the VS Code extension via its own guard, but the CLI's autosave then saw an unflagged session and overwrote the user's name with an auto-derived one.
