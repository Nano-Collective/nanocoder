---
"@nanocollective/nanocoder": patch
---

`list_directory` and the file explorer now hide a directory matched by a directory-only ignore pattern such as `dist/` or `node_modules/` in `.gitignore` or `.nanocoderignore`. Its contents were already hidden, but the folder itself still listed, and listing it then reported it as empty.
