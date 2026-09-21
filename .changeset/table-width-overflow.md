---
"@nanocollective/nanocoder": patch
---

Fixed markdown tables with many columns rendering wider than the terminal and breaking their own borders. Columns now shrink to fit, and a table too wide to fit at all is left as markdown. Closes #1404.
