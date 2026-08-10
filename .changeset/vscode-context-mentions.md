---
"@nanocollective/nanocoder": minor
---

Added `@` mention autocomplete to the VS Code extension's chat composer: typing `@` opens a floating dropdown of workspace files, folders and open editors, and selecting one attaches it as a context chip. Search runs on the extension host so it honours `files.exclude`/`search.exclude`, and a bare `@` lists open editor tabs with no disk I/O. Closes #747.
