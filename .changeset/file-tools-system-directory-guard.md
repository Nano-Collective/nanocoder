---
'@nanocollective/nanocoder': patch
---

Fixed file edits being able to write to system directories when the project root is a filesystem root, for example a container with the workspace mounted at `/`, where the containment check accepts every absolute path. The system-directory guard now lives in the shared path validator instead of only in `write_file`, so `write_file`, `string_replace`, `diff_edit` and `file_op` all refuse `/etc`, `/sys`, `/proc`, `/dev`, `/boot`, `C:\Windows` and `C:\Program Files`, and the most destructive file tool is no longer the only one protected. Thanks to @shravanramakunja. Closes #1941.
