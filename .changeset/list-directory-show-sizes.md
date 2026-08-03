---
"@nanocollective/nanocoder": minor
---

`list_directory` no longer emits per-entry byte sizes by default. Sizes cost tokens on every entry and are rarely load-bearing when the model is just orienting itself in a directory, and they forced an extra `lstat` call per file. Pass `showSizes: true` to opt back in. Closes #767.
