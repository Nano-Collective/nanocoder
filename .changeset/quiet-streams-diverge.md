---
"@nanocollective/nanocoder": patch
---

Fixed the bash tool silently dropping stdout when stderr was noisy; each stream now gets its own output budget and truncation marker. Worst case memory goes from 5MB to 10MB since both streams can now hit the cap at once. Closes #1140.
