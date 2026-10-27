---
"@nanocollective/nanocoder": patch
---

ACP editors now see everything a subagent does. Every subagent tool call is announced to the editor as it starts, not only the ones that need approval, and each one settles with the tool's real result: a call that fails after it was approved now shows as failed instead of completed. Subagent approvals follow the session's mode, so a `yolo` or `auto-accept` session is no longer prompted inside a subagent for tools it would not be prompted for at the top level. Each session's prompts reach its own editor, so two sessions running subagents at once can no longer answer each other's approvals. Closes #1105.
