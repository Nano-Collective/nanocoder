---
"@nanocollective/nanocoder": patch
---

Fix Enter submitting the old draft instead of the recalled prompt when ↑ and Enter reach the prompt together (a fast double press or a terminal that batches keys). A key typed straight after a history recall or a completion also edited the old text. Both now act on the text the prompt shows.
