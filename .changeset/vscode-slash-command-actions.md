---
"@nanocollective/nanocoder": patch
---

Added slash command quick actions to the VS Code extension chat panel. Typing `/` in the input opens an autocomplete menu listing `/test`, `/explain`, and `/doc`, which insert a human-readable prompt template into the textarea so the user sees and can edit exactly what gets sent, alongside the existing `/clear` and `/copy` commands, which complete to their name and run as they always have. The menu only opens on a slash that starts a line, so URLs and paths are left alone.
