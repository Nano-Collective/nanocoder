---
"@nanocollective/nanocoder": minor
---

Added automatic session titles. A session keeps its opening prompt as the title, and when that prompt is too thin to be useful the agent generates a descriptive name once, after the first turn that ran a tool or the first follow-up message. Manual renames are never overwritten. Titling uses the session's own model by default - set `sessions.titleModel` / `sessions.titleProvider` to point it at a cheaper one, or `sessions.smartTitles: false` to turn it off. Also fixed the CLI's autosave deriving the session title from the latest user message and rewriting it on every save, which overwrote titles in the store the VS Code extension reads from. Closes #808.
