---
'@nanocollective/nanocoder': patch
---

Consolidated the atomic-deletion overlap checks onto a single half-open `[start, end)` range helper, so the boundary tests that had drifted between `<` and `<=` now agree by construction rather than by coincidence. Deletion behaviour is unchanged - the longhand forms were already equivalent for every reachable input. Placeholder lookup at a cursor position does change: a position now counts as on a placeholder when it falls in `(start, end]`, so the position immediately before a placeholder reads as outside it and the position immediately after it reads as inside, matching where the cursor actually sits when you press Backspace. Thanks to @hiarun02. Closes #977.
