---
"@nanocollective/nanocoder": patch
---

Fix the composer growing past the terminal on a tall multi-line draft, pushing its own border and the mode line off screen while still typing. The input box now caps its visible height and scrolls internally to keep the cursor's line in view, matching the existing caps used elsewhere (completion lists, queued messages). Closes #1557.
