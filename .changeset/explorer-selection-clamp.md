---
'@nanocollective/nanocoder': patch
---

`/explorer` no longer strands the selection when its list gets shorter. Leaving a search swaps the list from every match back to only the expanded rows, but the selected row was only ever clamped inside the arrow-key handlers, so after a long search it pointed past the end of the tree: no row highlighted, the path readout blank, Up and Enter doing nothing, and Down jumping straight to the last row. The selection is now pulled back into range whenever the list shrinks. Closes #1454.
