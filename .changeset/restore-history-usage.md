---
"@nanocollective/nanocoder": patch
---

Fixed the VS Code extension dropping token and estimated-cost footers when a saved chat is reopened. Completed ACP turns now persist their response usage on the matching assistant message and restore it during history replay, while existing sessions without usage metadata continue to load unchanged. Closes #1097.
