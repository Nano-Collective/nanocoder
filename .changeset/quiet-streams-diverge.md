---
"@nanocollective/nanocoder": patch
---

Fixed the bash tool silently dropping stdout when stderr was noisy; each stream now gets its own output budget and truncation marker. Closes #1140.
