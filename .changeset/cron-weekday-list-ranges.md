---
"@nanocollective/nanocoder": patch
---

`/skills schedule` now labels a weekday list that contains a range correctly: `0 9 * * 1-3,5` reads `Mon-Wed, Fri at 9:00` instead of `Mon-3,5 at 9:00`.
