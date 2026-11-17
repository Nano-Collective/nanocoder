---
'@nanocollective/nanocoder': minor
---

The VS Code extension now offers "Fix with Nanocoder" when a command fails in an integrated terminal. A notification names the command and its exit code, and the action opens the chat and sends the command, its exit code, the working directory and the end of its output (colours and shell integration markers removed). It needs the terminal's shell integration to report exit codes, and a command stopped with Ctrl+C is not offered. The `nanocoder.terminalErrors` setting turns it off. Closes #753.
