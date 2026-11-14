---
"@nanocollective/nanocoder": patch
---

A stats ledger that is corrupt or was written by a newer Nanocoder is no longer wiped on the next flush. The file is left untouched and copied to `stats.json.bak` once, with a warning, so lifetime totals stay recoverable. Closes #2206.
