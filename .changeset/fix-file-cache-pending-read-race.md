---
"@nanocollective/nanocoder": patch
---

Fixed a race in the file content cache where an older request's cleanup could delete a newer, still in-flight request's pending read, breaking dedup. Closes #840.
