---
'@nanocollective/nanocoder': patch
---

`read_file` no longer answers "already in context" for a file the current history never saw. Each ACP chat keeps its own stubs, and ACP `/clear`, retry, timeline revert, and loading a chat from disk reset them. TUI `/resume` resets them too. Closes #793.
