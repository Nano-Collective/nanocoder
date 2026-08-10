---
"@nanocollective/nanocoder": patch
---

`search_file_contents` no longer puts a blank line between context-free matches, and decides its layout from the `contextLines` argument rather than sniffing each match for a newline. A context block that collapsed to a single line (single-line files, or when truncation dropped every newline) previously rendered with the exact-match header and a doubled line number.
