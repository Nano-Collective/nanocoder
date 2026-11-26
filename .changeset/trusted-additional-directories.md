---
"@nanocollective/nanocoder": minor
---

Add repeatable `--add-dir` and `--add-dir-ro` flags, `nanocoder.additionalDirectories` configuration, and `/add-dir` for working across trusted directories. File tools, search, and file mentions recognize the additional roots, read-only roots protect reference files from built-in mutations, and `/status` lists active directories. Closes #2267.
