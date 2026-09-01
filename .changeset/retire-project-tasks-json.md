---
"@nanocollective/nanocoder": minor
---

Retired the legacy `.nanocoder/tasks.json` file in the working directory. Task state is now session-scoped and stored with the session's other artifacts under the app data directory, so nanocoder no longer writes agent bookkeeping into your repository and two concurrent sessions no longer share one task list. Resuming a session restores its tasks. Any leftover `.nanocoder/tasks.json` is ignored and can be deleted.
