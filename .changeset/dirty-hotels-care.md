---
"@nanocollective/nanocoder": patch
---

Preserve HTML literals inside fenced markdown code blocks by extracting code blocks before HTML entity decoding and <br> conversion. Adds tests to ensure HTML tags and entities remain unchanged inside code fences. Thanks to @Shreya657. Closes #1591.
  