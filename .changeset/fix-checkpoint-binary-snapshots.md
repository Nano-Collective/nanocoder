---
"@nanocollective/nanocoder": patch
---

Fixed checkpoints irrecoverably corrupting binary files. Every layer of the pipeline read and wrote contents as UTF-8, so each byte of an image, `.vsix` bundle or database came back as U+FFFD — and because the damage was done at save time, the checkpoint itself held nothing left to recover. Snapshots are now carried as `Buffer` and written with no encoding argument; text still round-trips byte-identically.

A checkpoint that came out incomplete also restored in silence. Files that could not be read at capture, and files dropped by the `MAX_CHECKPOINT_FILES` cap, are now recorded on the checkpoint's metadata and named when it is restored. Old checkpoints still load, though binaries captured before this fix stay corrupt. Closes #962.
