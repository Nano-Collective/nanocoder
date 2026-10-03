---
"@nanocollective/nanocoder": patch
---

A shell command that exits non-zero is no longer displayed as a success in the interactive TUI. `execute_bash` only prefixed its result with `Error: ` when the command could not be spawned at all, and the display layer decided success purely by sniffing for that prefix, so a broken build or a failing test run rendered as `⚒ Ran 1 command`, identical to a clean run. The streamed bash path now sets `ToolResult.isError` on a non-zero exit and the compact display branches on that flag, showing `⚒ execute_bash failed` instead. Together with the earlier `--plain`/`--json`/ACP fix, this closes #1371.
