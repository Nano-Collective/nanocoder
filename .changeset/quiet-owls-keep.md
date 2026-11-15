---
"@nanocollective/nanocoder": patch
---

An unreadable preferences file is now copied to `<file>.bak` before the next settings write, so a single changed setting can no longer wipe the settings that could not be parsed (`trustedDirectories`, `lastProvider`, and the rest). The next read of the same corrupted file does not overwrite the backup, and a repaired-then-broken file gets a fresh one. Closes #2198.
