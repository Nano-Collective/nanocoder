---
"@nanocollective/nanocoder": minor
---

Added `/review` slash command and `nanocoder review <branch|pr-number>` CLI command for AI-powered code review of branches and pull requests. The command fetches the diff against the default branch, feeds it to a dedicated architect-level review prompt, and returns actionable findings covering bugs, security issues, and style violations. For PR numbers, the `gh` CLI is required. Refs #1002.
