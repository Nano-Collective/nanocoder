---
"@nanocollective/nanocoder": patch
---

Fixed a `{}` entry appearing as the oldest prompt in Up-arrow history for new users. The history file is seeded as an empty JSON object, which was being read as a one-line legacy history.
