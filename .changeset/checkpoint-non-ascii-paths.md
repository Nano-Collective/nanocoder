---
"@nanocollective/nanocoder": patch
---

Fixed checkpoints skipping files whose names contain non-ASCII characters. Git quotes such paths by default, so `café.txt` was reported as `"caf\303\251.txt"` and never found on disk; it was left out of the snapshot entirely and listed as missing, so restoring a checkpoint did not bring it back. The modified and untracked listings now read NUL-separated paths, which are never quoted, so such files are captured and restored regardless of their name. Closes #2194.
