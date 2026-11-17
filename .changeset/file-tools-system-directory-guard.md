---
"@nanocollective/nanocoder": patch
---

Guard file-op move source in system directories (not just the destination), and keep copy source unrestricted. The shared `validatePathPair` validator now: (1) rejects a move source inside a system directory (since rename() writes to the source directory), while (2) leaving copy source unrestricted — only the destination is guarded for copy operations. The system-directory write guard now lives in the shared path validator instead of only in `write_file`, so `write_file`, `string_replace`, `diff_edit`, `file_op` and `lsp_format_document` all refuse writes to `/etc`, `/sys`, `/proc`, `/dev`, `/boot`, `C:\Windows`, and `C:\Program Files`. A new serial test in `source/utils/path-validators.spec.ts` asserts the move-source guard and the copy-source-not-guarded behavior.
