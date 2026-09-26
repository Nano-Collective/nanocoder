---
'@nanocollective/nanocoder': patch
---

Enter now runs a slash command you have typed in full. When the text matched exactly one command, the completion menu opened with it highlighted, and Enter "selected" it: it re-applied text that was already there, closed the menu and stopped, so every command needed a second Enter to run. If the highlighted completion is what you typed, Enter now submits it straight away. Partly typed commands still complete on Enter as before. Closes #1431.
