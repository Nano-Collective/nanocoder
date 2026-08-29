---
"@nanocollective/nanocoder": minor
---

Added a session-scoped artifact lifecycle to the CLI and VS Code: implementation plans with explicit review and prose-plan fallback persistence, persistent task tracking, completion walkthroughs after an approved plan, clickable artifact shortcuts that survive session resume, and reliable cancellation recovery. Task lists now live with the session instead of `.nanocoder/tasks.json` in your project, so `/clear` starts a fresh list while the previous session keeps its record. Plan approval always works, falling back to the plan in the transcript when no artifact was written. Headless `--plain` runs keep their artifacts ephemeral and are not forced to produce a walkthrough. Thanks to @2409324124. Closes #805.
