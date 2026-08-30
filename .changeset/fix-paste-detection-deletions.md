---
"@nanocollective/nanocoder": patch
---

Fixed paste detection extracting the wrong text from the input buffer. It assumed every insertion was appended at the end, so pasting with the cursor anywhere but the end stored a truncated placeholder, and deletions or unchanged input reported a slice from the middle of the string. Detection now diffs the buffer against its previous revision and ignores non-positive deltas. Closes #979.
