---
"@nanocollective/nanocoder": minor
---

Added support for a .nanocoderignore file. Patterns in it keep tracked-but-noisy files (lockfiles, generated fixtures) out of directory listings, file search and the file explorer, so they stop eating context even though .gitignore doesn't cover them. It is a context-hygiene tool rather than a secrets boundary: read_file and execute_bash don't consult it, and checkpoints deliberately skip it so hidden files are still snapshotted and restored. Thanks to @A-S-Manoj. Closes #755.
