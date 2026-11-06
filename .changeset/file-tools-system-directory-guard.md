---
'@nanocollective/nanocoder': patch
---

Fixed file operations being able to target system directories when the project root is a filesystem root (for example a container with the workspace mounted at `/`), where the containment check accepts every absolute path. The system-directory write guard now lives in the shared path validator instead of only in `write_file`, so `write_file`, `string_replace`, `diff_edit`, `file_op`, and `lsp_format_document` refuse writes to `/etc`, `/sys`, `/proc`, `/dev`, `/boot`, `C:\Windows`, and `C:\Program Files`. For `file_op` copy/move, the guard applies to the destination; the source path is read, not written. Thanks to @shravanramakunja. Closes #1941.
