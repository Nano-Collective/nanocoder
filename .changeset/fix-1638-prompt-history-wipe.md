---
'@nanocollective/nanocoder': patch
---

Fix the prompt history file being wiped when it is truncated or otherwise unreadable. A crash mid-save could leave `.nano-coder-history` starting with the JSON marker followed by broken JSON; the next load treated the parse failure exactly like a missing file, and the next prompt replaced the file with that empty history. The bad file is now moved aside to `.nano-coder-history.corrupt` (a timestamped name if one is already there, so a later corruption never overwrites an earlier backup) and saves write to a temporary file that is renamed into place so a crash can no longer truncate the history. Thanks to @Vishesh-Verma-07. Closes #1638.
