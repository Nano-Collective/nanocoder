---
'@nanocollective/nanocoder': patch
---

Multi-line paste placeholders now show a line count instead of a character count, so pasting a code block, log, or stack trace reads as `[Paste #1: 7 lines]` rather than `[Paste #1: 157 chars]`. A single trailing line break is not counted as an extra line. Long single-line pastes keep the `[Paste #N: X chars]` label, and a paste that arrives in chunks updates its label as it grows. Closes #1292.
