---
"@nanocollective/nanocoder": patch
---

Fixed a paste whose text contains the terminal's own end-of-paste bytes being cut short, with the rest arriving as stray keystrokes. Where the chunk shows a later end marker with no paste starting in between, the earlier one is now read as part of the text. Closes #1433.
