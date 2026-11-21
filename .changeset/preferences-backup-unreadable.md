---
"@nanocollective/nanocoder": patch
---

A preferences file that cannot be parsed is now copied to `<file>.bak` before anything saves over it, so a corrupt file no longer wipes `trustedDirectories`, `lastProvider` and the other settings on the next change. The backup is made once per corrupted version and the warning names the backup path. Closes #2198.
