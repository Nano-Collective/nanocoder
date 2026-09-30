---
"@nanocollective/nanocoder": patch
---

Cap the Architect review bar's changed/new-file lists at 5 rows with a "+N more" line, matching the same cap already used for the live tool-count summary. It used to print every file with no limit, so on a turn touching many files the list pushed the Keep / Revert / Revert & Revise choices below the bottom of the screen. Closes #1533.
