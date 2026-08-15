---
"@nanocollective/nanocoder": minor
---

`list_directory` no longer includes file sizes by default — they cost an `lstat` syscall per file plus output tokens for information that's rarely needed just to orient in a directory. Pass `showSizes=true` to opt back in, or use `read_file` with `metadata_only=true` for a single file's size.
