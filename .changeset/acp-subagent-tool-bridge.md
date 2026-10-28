---
"@nanocollective/nanocoder": patch
---

ACP editors now see everything a subagent does. Every subagent tool call is announced to the editor as it starts, not only the ones that need approval, and each one settles with the tool's real result: a call that fails after it was approved, or that reports its failure as an `Error: ...` message, now shows as failed instead of completed, and a call the subagent is refused (an unknown tool, or one its mode does not allow) leaves a failed card instead of nothing. A subagent follows its session's mode: a `yolo` or `auto-accept` session is no longer prompted inside a subagent for tools it would not be prompted for at the top level, and a `plan` session's subagents are no longer offered the editing tools. Each session's prompts reach its own editor, so two sessions running subagents at once can no longer answer each other's approvals. Closes #1105.
