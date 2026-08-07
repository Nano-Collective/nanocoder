---
"@nanocollective/nanocoder": patch
---

Fixed string_replace and write_file tool responses to return raw file contents instead of line-number-prefixed output, making them consistent with read_file and preventing follow-up edit mismatches. Thanks to @Pixie-19. Closes #765.
