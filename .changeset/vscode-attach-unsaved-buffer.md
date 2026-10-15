---
"@nanocollective/nanocoder": patch
---

Fix `@file` attachments in the VS Code chat panel sending the saved file instead of what is in the editor. Attachments were read from disk, so unsaved edits never reached the model. The open editor's text is now used when the file is open (with the same size cap and binary check), falling back to the file on disk otherwise. Closes #1723.
