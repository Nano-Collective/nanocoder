---
"@nanocollective/nanocoder": minor
---

Added `@` mention autocomplete to the VS Code extension's chat composer: typing `@` opens a floating dropdown of workspace files, folders and open editors, and selecting one attaches it as a context chip. Search runs on the extension host, which merges your `files.exclude` and `search.exclude` settings into the exclude list so hidden files stay out of the dropdown, and a bare `@` lists open editor tabs with no disk I/O. Attached files are now read with a 100 KB cap and binaries are skipped, so a mis-picked lockfile can no longer swallow the context window. Closes #747.
