---
'@nanocollective/nanocoder': patch
---

Timeline index saves are now atomic: `timeline.json` is written to a temporary file and renamed into place instead of being overwritten in place. A crash or kill mid-save can no longer leave a truncated index behind, which previously cost the session every checkpoint (the corrupted index was discarded on next load). Thanks to @puri-adityakumar. Closes #1130.
