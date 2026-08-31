---
"@nanocollective/nanocoder": minor
---

Auto-generate descriptive filenames for /export instead of generic timestamps. Closes #934

Exports are now contained to the project directory, matching read_file / write_file / string_replace: `~` is not expanded and absolute paths outside the project root are refused rather than written. Rejections name the specific cause (null byte, `~`, `..` segment, outside the root) instead of failing generically.
