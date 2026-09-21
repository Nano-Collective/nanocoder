---
"@nanocollective/nanocoder": patch
---

Fix the composer input box clipping its left border, prompt marker, and placeholder start on terminals narrower than 40 columns, by clamping the box's width floor to the actual terminal width.
