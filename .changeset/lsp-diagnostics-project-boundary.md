---
"@nanocollective/nanocoder": patch
---

`lsp_get_diagnostics` now only accepts files inside the project, like `read_file`. It used to pass any existing path to the language server, which reads the file's contents, so a path such as `../other/file.ts` or an absolute path elsewhere on disk was accepted. Such paths are now rejected with the same "Path must be within the project directory" error the file tools give.
