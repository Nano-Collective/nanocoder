---
'@nanocollective/nanocoder': patch
---

Pressing Enter on a fully typed slash command now runs it on the first press instead of needing a second Enter to dismiss the completion menu. The menu opens with the exact, unambiguous match already highlighted, and Enter used to "select" it - re-applying text that was already there and closing the menu - rather than submitting. Partly typed commands still complete on Enter as before. Closes #1431.
