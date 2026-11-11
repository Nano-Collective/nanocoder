---
"@nanocollective/nanocoder": patch
---

Fixed file tools writing outside the project through a dangling symlink. A link whose target did not exist yet (for example a cloned repo shipping `notes.md -> ~/.ssh/authorized_keys`) passed the project containment check, so `write_file` or a `file_op` copy onto it created the file at the outside target. Path validation now follows symlinks component by component, including dangling links, link chains and `..` inside a link target, and rejects symlink loops.
