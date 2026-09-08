---
'@nanocollective/nanocoder': patch
---

Timeline index saves are now atomic: `timeline.json` is written to a temporary file and renamed into place instead of being overwritten in place. If the process dies mid-save, readers only ever see the complete old or complete new index, so a torn write can no longer silently discard every checkpoint of the session. Thanks to @puri-adityakumar. Closes #1130.
