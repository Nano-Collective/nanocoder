---
"@nanocollective/nanocoder": patch
---

Fixed `search_file_contents` searching outside the project through a symlink. Its `path` argument was only checked lexically, and ripgrep follows a symlink named on its command line, so `path: "link"` with `link -> ~` grepped the home directory. The path now goes through the same symlink-aware check as `read_file` and `list_directory`.
